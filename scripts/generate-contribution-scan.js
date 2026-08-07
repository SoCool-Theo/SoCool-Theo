"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG = Object.freeze({
  days: 7,
  cellSize: 10,
  gap: 3,
  padding: 16,
  dayLabelWidth: 30,
  monthLabelHeight: 18,
  totalsFooterHeight: 30,
  framePaddingX: 42,
  framePaddingY: 42,
  frameRadius: 26,
  frameInset: 5,
  innerFrameInset: 14,
  calendarPanelMargin: 10,
  animationSeconds: 5.5,
  scanStartSeconds: 0.35,
  scanEndSeconds: 1.55,
  holdEndSeconds: 5,
});

const CONTRIBUTION_LEVELS = Object.freeze({
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
});

const MONTH_NAMES = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

const CONTRIBUTION_QUERY = `
  query ContributionCalendar($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              contributionLevel
              date
              weekday
            }
          }
        }
      }
    }
  }
`;

function normalizeTime(seconds) {
  return Number((seconds / CONFIG.animationSeconds).toFixed(6));
}

function normalizeContributionCalendar(calendar) {
  const weeks = calendar.weeks.map((week) => {
    const days = Array.from({ length: CONFIG.days }, () => ({
      count: 0,
      date: null,
      level: 0,
    }));

    week.contributionDays.forEach((day) => {
      const level = CONTRIBUTION_LEVELS[day.contributionLevel];

      if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday >= CONFIG.days) {
        throw new Error(`GitHub returned an invalid weekday: ${day.weekday}`);
      }

      if (level === undefined) {
        throw new Error(`GitHub returned an unknown contribution level: ${day.contributionLevel}`);
      }

      days[day.weekday] = {
        count: day.contributionCount,
        date: day.date,
        level,
      };
    });

    return days;
  });

  if (weeks.length === 0) {
    throw new Error("GitHub returned an empty contribution calendar.");
  }

  return {
    months: summarizeMonths(weeks),
    totalContributions: calendar.totalContributions,
    weeks,
  };
}

function summarizeMonths(weeks) {
  const monthsByKey = new Map();

  weeks.forEach((week, weekIndex) => {
    week.forEach((day) => {
      if (!day.date) return;

      const key = day.date.slice(0, 7);
      let month = monthsByKey.get(key);

      if (!month) {
        const monthIndex = Number(day.date.slice(5, 7)) - 1;
        month = {
          endWeek: weekIndex,
          key,
          label: MONTH_NAMES[monthIndex],
          startWeek: weekIndex,
          totalContributions: 0,
          year: Number(day.date.slice(0, 4)),
        };
        monthsByKey.set(key, month);
      }

      month.endWeek = weekIndex;
      month.totalContributions += day.count;
    });
  });

  return Array.from(monthsByKey.values());
}

async function fetchGitHubContributionData(username, token) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "contribution-scan-generator",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      query: CONTRIBUTION_QUERY,
      variables: { login: username },
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(
      `GitHub GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`,
    );
  }

  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;

  if (!calendar) {
    throw new Error(`GitHub user "${username}" was not found or has no contribution calendar.`);
  }

  return normalizeContributionCalendar(calendar);
}

function cellPosition(week, day, gridLeft, gridTop) {
  const step = CONFIG.cellSize + CONFIG.gap;
  return {
    x: gridLeft + week * step,
    y: gridTop + day * step,
  };
}

function renderBaseGrid(weekCount, gridLeft, gridTop) {
  const cells = [];

  for (let week = 0; week < weekCount; week += 1) {
    for (let day = 0; day < CONFIG.days; day += 1) {
      const { x, y } = cellPosition(week, day, gridLeft, gridTop);
      cells.push(
        `    <rect class="base-cell" x="${x}" y="${y}" width="${CONFIG.cellSize}" height="${CONFIG.cellSize}" rx="2" />`,
      );
    }
  }

  return cells.join("\n");
}

function renderContributionGrid(contributions, gridLeft, gridTop) {
  const cells = [];

  contributions.forEach((weekData, week) => {
    weekData.forEach((contribution, day) => {
      if (contribution.level === 0) return;

      const { x, y } = cellPosition(week, day, gridLeft, gridTop);
      const contributionLabel = contribution.count === 1 ? "contribution" : "contributions";
      cells.push(
        `      <rect class="level-${contribution.level}" x="${x}" y="${y}" width="${CONFIG.cellSize}" height="${CONFIG.cellSize}" rx="2"><title>${contribution.date}: ${contribution.count} ${contributionLabel}</title></rect>`,
      );
    });
  });

  return cells.join("\n");
}

function renderCalendarLabels(months, gridLeft, gridTop, gridWidth, gridHeight) {
  const step = CONFIG.cellSize + CONFIG.gap;
  const dayLabels = [
    { day: 1, label: "Mon" },
    { day: 3, label: "Wed" },
    { day: 5, label: "Fri" },
  ];
  const monthLabelY = gridTop - 8;
  const dividerY = gridTop + gridHeight + 10;
  const totalLabelY = dividerY + 17;
  const labels = [];

  dayLabels.forEach(({ day, label }) => {
    const y = gridTop + day * step + CONFIG.cellSize / 2;
    labels.push(
      `    <text class="axis-label" x="${gridLeft - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${label}</text>`,
    );
  });

  months.forEach((month) => {
    const monthX = gridLeft + month.startWeek * step;
    const totalX =
      gridLeft + ((month.startWeek + month.endWeek) / 2) * step + CONFIG.cellSize / 2;
    const accessibleMonth = `${month.label} ${month.year}`;

    labels.push(
      `    <text class="axis-label" x="${monthX}" y="${monthLabelY}">${month.label}<title>${accessibleMonth}</title></text>`,
    );
    labels.push(
      `    <text class="month-total" x="${totalX}" y="${totalLabelY}" text-anchor="middle">${month.totalContributions}<title>${accessibleMonth}: ${month.totalContributions} contributions</title></text>`,
    );
  });

  labels.push(
    `    <line class="totals-divider" x1="${gridLeft}" y1="${dividerY}" x2="${gridLeft + gridWidth}" y2="${dividerY}" />`,
  );
  labels.push(
    `    <text class="axis-label" x="${gridLeft - 8}" y="${totalLabelY}" text-anchor="end">Total</text>`,
  );

  return labels.join("\n");
}

function renderContributionLegend(innerWidth) {
  const cellSize = 10;
  const cellGap = 3;
  const cellCount = 5;
  const labelGap = 8;
  const lessLabelWidth = 24;
  const moreLabelWidth = 30;
  const rightPadding = 14;
  const cellY = 3;
  const labelY = 12;
  const moreX = innerWidth - rightPadding - moreLabelWidth;
  const cellsWidth = cellCount * cellSize + (cellCount - 1) * cellGap;
  const cellsX = moreX - labelGap - cellsWidth;
  const lessX = cellsX - labelGap - lessLabelWidth;
  const cells = ["legend-empty", "level-1", "level-2", "level-3", "level-4"]
    .map((className, index) => {
      const x = cellsX + index * (cellSize + cellGap);
      return `    <rect class="legend-cell ${className}" x="${x}" y="${cellY}" width="${cellSize}" height="${cellSize}" rx="2" />`;
    })
    .join("\n");

  return `    <text class="legend-label" x="${lessX}" y="${labelY}">Less</text>
${cells}
    <text class="legend-label" x="${moreX}" y="${labelY}">More</text>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildSvg(contributionData, username) {
  const contributions = contributionData.weeks;
  const weekCount = contributions.length;
  const step = CONFIG.cellSize + CONFIG.gap;
  const gridWidth = (weekCount - 1) * step + CONFIG.cellSize;
  const gridHeight = (CONFIG.days - 1) * step + CONFIG.cellSize;
  const innerWidth = gridWidth + CONFIG.padding * 2 + CONFIG.dayLabelWidth;
  const innerHeight =
    gridHeight +
    CONFIG.padding * 2 +
    CONFIG.monthLabelHeight +
    CONFIG.totalsFooterHeight;
  const width = innerWidth + CONFIG.framePaddingX * 2;
  const height = innerHeight + CONFIG.framePaddingY * 2;
  const calendarPanelX = CONFIG.framePaddingX - CONFIG.calendarPanelMargin;
  const calendarPanelY = CONFIG.framePaddingY - CONFIG.calendarPanelMargin;
  const calendarPanelWidth = innerWidth + CONFIG.calendarPanelMargin * 2;
  const calendarPanelHeight = innerHeight + CONFIG.calendarPanelMargin * 2;
  const gridLeft = CONFIG.padding + CONFIG.dayLabelWidth;
  const gridTop = CONFIG.padding + CONFIG.monthLabelHeight;
  const gridRight = gridLeft + gridWidth;
  const duration = `${CONFIG.animationSeconds}s`;
  const scanStart = normalizeTime(CONFIG.scanStartSeconds);
  const scanEnd = normalizeTime(CONFIG.scanEndSeconds);
  const holdEnd = normalizeTime(CONFIG.holdEndSeconds);
  const scannerFadeInStart = normalizeTime(CONFIG.scanStartSeconds - 0.05);
  const scannerFadeOutStart = normalizeTime(CONFIG.scanEndSeconds - 0.05);
  const revealTimes = `0;${scanStart};${scanEnd};${holdEnd};1`;
  const safeUsername = escapeXml(username);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${safeUsername}'s animated contribution scan</title>
  <desc id="description">A glowing vertical line moves from left to right and reveals ${contributionData.totalContributions} contributions from ${safeUsername}'s latest GitHub contribution calendar.</desc>

  <defs>
    <style>
      .base-cell { fill: #161b22; stroke: #234c35; stroke-width: 0.5; }
      .level-1 { fill: #0e4429; }
      .level-2 { fill: #006d32; }
      .level-3 { fill: #26a641; }
      .level-4 { fill: #39d353; }
      .scanner-line { stroke: #7ee787; }
      .scanner-stop { stop-color: #39d353; }
      .axis-label, .month-total, .legend-label {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .axis-label, .month-total {
        font-size: 9px;
      }
      .axis-label { fill: #8b949e; }
      .month-total { fill: #c9d1d9; font-weight: 600; }
      .legend-label { fill: #8b949e; font-size: 11px; }
      .legend-cell { stroke-width: 0.5; }
      .legend-empty { fill: #161b22; stroke: #234c35; }
      .totals-divider { stroke: #234c35; stroke-width: 0.5; }
    </style>

    <linearGradient id="frame-background" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#07110b" />
      <stop offset="48%" stop-color="#0b2415" />
      <stop offset="100%" stop-color="#06100a" />
    </linearGradient>

    <linearGradient id="calendar-background" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#07130c" />
      <stop offset="50%" stop-color="#050d09" />
      <stop offset="100%" stop-color="#09180f" />
    </linearGradient>

    <radialGradient id="ambient-glow" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#238636" stop-opacity="0.3" />
      <stop offset="55%" stop-color="#0e4429" stop-opacity="0.12" />
      <stop offset="100%" stop-color="#0e4429" stop-opacity="0" />
    </radialGradient>

    <pattern id="circuit-pattern" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M0 14h18l6 6h16l8-8h8M0 42h14l8-8h13l7 7h14M14 0v10l7 7M42 56V46l-7-7" fill="none" stroke="#238636" stroke-width="0.65" opacity="0.32" />
      <circle cx="18" cy="14" r="1.2" fill="#39d353" opacity="0.28" />
      <circle cx="42" cy="42" r="1.2" fill="#39d353" opacity="0.22" />
    </pattern>

    <filter id="outer-glow" x="-20%" y="-30%" width="140%" height="160%">
      <feGaussianBlur stdDeviation="3.2" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <linearGradient id="scanner-beam" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop class="scanner-stop" offset="0%" stop-opacity="0" />
      <stop class="scanner-stop" offset="50%" stop-opacity="0.65" />
      <stop class="scanner-stop" offset="100%" stop-opacity="0" />
    </linearGradient>

    <filter id="scanner-glow" x="-200%" y="-30%" width="400%" height="160%">
      <feGaussianBlur stdDeviation="2.4" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <clipPath id="calendar-panel-clip">
      <rect x="${calendarPanelX}" y="${calendarPanelY}" width="${calendarPanelWidth}" height="${calendarPanelHeight}" rx="16" />
    </clipPath>

    <clipPath id="reveal-clip">
      <rect x="${gridLeft}" y="${gridTop}" width="0" height="${gridHeight}">
        <animate
          attributeName="width"
          values="0;0;${gridWidth};${gridWidth};0"
          keyTimes="${revealTimes}"
          dur="${duration}"
          repeatCount="indefinite"
        />
      </rect>
    </clipPath>

    <clipPath id="calendar-reveal-clip">
      <rect x="0" y="0" width="0" height="${innerHeight}">
        <animate
          attributeName="width"
          values="0;${gridLeft};${gridRight};${gridRight};0"
          keyTimes="${revealTimes}"
          dur="${duration}"
          repeatCount="indefinite"
        />
      </rect>
    </clipPath>
  </defs>

  <rect
    id="outer-frame"
    x="${CONFIG.frameInset}"
    y="${CONFIG.frameInset}"
    width="${width - CONFIG.frameInset * 2}"
    height="${height - CONFIG.frameInset * 2}"
    rx="${CONFIG.frameRadius}"
    fill="url(#frame-background)"
    stroke="#39d353"
    stroke-width="2.4"
    filter="url(#outer-glow)"
  />

  <rect
    id="outer-frame-highlight"
    x="${CONFIG.innerFrameInset}"
    y="${CONFIG.innerFrameInset}"
    width="${width - CONFIG.innerFrameInset * 2}"
    height="${height - CONFIG.innerFrameInset * 2}"
    rx="${CONFIG.frameRadius - 8}"
    fill="url(#ambient-glow)"
    stroke="none"
  />

  <rect
    id="calendar-panel"
    x="${calendarPanelX}"
    y="${calendarPanelY}"
    width="${calendarPanelWidth}"
    height="${calendarPanelHeight}"
    rx="16"
    fill="url(#calendar-background)"
    stroke="#2ea043"
    stroke-width="1.4"
  />

  <rect
    id="circuit-texture"
    x="${calendarPanelX}"
    y="${calendarPanelY}"
    width="${calendarPanelWidth}"
    height="${calendarPanelHeight}"
    fill="url(#circuit-pattern)"
    clip-path="url(#calendar-panel-clip)"
    opacity="0.2"
  />

  <g id="contribution-calendar" transform="translate(${CONFIG.framePaddingX} ${CONFIG.framePaddingY})">
  <g id="base-grid" shape-rendering="geometricPrecision">
${renderBaseGrid(weekCount, gridLeft, gridTop)}
  </g>

  <g id="revealed-contributions" clip-path="url(#reveal-clip)" shape-rendering="geometricPrecision">
${renderContributionGrid(contributions, gridLeft, gridTop)}
    <animate
      attributeName="opacity"
      values="1;1;1;0"
      keyTimes="0;${scanEnd};${holdEnd};1"
      dur="${duration}"
      repeatCount="indefinite"
    />
  </g>

  <g id="calendar-labels" clip-path="url(#calendar-reveal-clip)">
    <g id="contribution-legend" role="img" aria-label="Contribution intensity from less to more">
${renderContributionLegend(innerWidth)}
    </g>
${renderCalendarLabels(contributionData.months, gridLeft, gridTop, gridWidth, gridHeight)}
    <animate
      attributeName="opacity"
      values="1;1;1;0"
      keyTimes="0;${scanEnd};${holdEnd};1"
      dur="${duration}"
      repeatCount="indefinite"
    />
  </g>

  <g id="scanner" filter="url(#scanner-glow)" opacity="0">
    <rect x="-14" y="${gridTop - 4}" width="28" height="${gridHeight + 8}" fill="url(#scanner-beam)" />
    <line class="scanner-line" x1="0" y1="${gridTop - 2}" x2="0" y2="${gridTop + gridHeight + 2}" stroke-width="1.1" />
    <animateTransform
      attributeName="transform"
      type="translate"
      values="${gridLeft} 0;${gridLeft} 0;${gridRight} 0;${gridRight} 0;${gridLeft} 0"
      keyTimes="${revealTimes}"
      dur="${duration}"
      repeatCount="indefinite"
    />
    <animate
      attributeName="opacity"
      values="0;0;1;1;0;0"
      keyTimes="0;${scannerFadeInStart};${scanStart};${scannerFadeOutStart};${scanEnd};1"
      dur="${duration}"
      repeatCount="indefinite"
    />
  </g>
  </g>
</svg>
`;
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const outputDirectory = path.join(projectRoot, "generated");
  const outputPath = path.join(outputDirectory, "contribution-scan.svg");
  const username = process.env.GITHUB_USERNAME || process.env.GITHUB_ACTOR || "SoCool-Theo";
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (!token) {
    throw new Error(
      "Set GITHUB_TOKEN or GH_TOKEN before running the generator. GitHub Actions supplies GITHUB_TOKEN automatically.",
    );
  }

  const contributionData = await fetchGitHubContributionData(username, token);
  const svg = buildSvg(contributionData, username);

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(outputPath, svg, "utf8");

  console.log(
    `Generated ${path.relative(projectRoot, outputPath)} for ${username} (${contributionData.totalContributions} contributions).`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
