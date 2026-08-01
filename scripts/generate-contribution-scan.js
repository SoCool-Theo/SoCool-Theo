"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONFIG = Object.freeze({
  days: 7,
  cellSize: 10,
  gap: 3,
  padding: 16,
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
    totalContributions: calendar.totalContributions,
    weeks,
  };
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

function cellPosition(week, day) {
  const step = CONFIG.cellSize + CONFIG.gap;
  return {
    x: CONFIG.padding + week * step,
    y: CONFIG.padding + day * step,
  };
}

function renderBaseGrid(weekCount) {
  const cells = [];

  for (let week = 0; week < weekCount; week += 1) {
    for (let day = 0; day < CONFIG.days; day += 1) {
      const { x, y } = cellPosition(week, day);
      cells.push(
        `    <rect class="base-cell" x="${x}" y="${y}" width="${CONFIG.cellSize}" height="${CONFIG.cellSize}" rx="2" />`,
      );
    }
  }

  return cells.join("\n");
}

function renderContributionGrid(contributions) {
  const cells = [];

  contributions.forEach((weekData, week) => {
    weekData.forEach((contribution, day) => {
      if (contribution.level === 0) return;

      const { x, y } = cellPosition(week, day);
      const contributionLabel = contribution.count === 1 ? "contribution" : "contributions";
      cells.push(
        `      <rect class="level-${contribution.level}" x="${x}" y="${y}" width="${CONFIG.cellSize}" height="${CONFIG.cellSize}" rx="2"><title>${contribution.date}: ${contribution.count} ${contributionLabel}</title></rect>`,
      );
    });
  });

  return cells.join("\n");
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
  const width = gridWidth + CONFIG.padding * 2;
  const height = gridHeight + CONFIG.padding * 2;
  const gridLeft = CONFIG.padding;
  const gridTop = CONFIG.padding;
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
      .base-cell { fill: #ebedf0; stroke: #d0d7de; stroke-width: 0.5; }
      .level-1 { fill: #9be9a8; }
      .level-2 { fill: #40c463; }
      .level-3 { fill: #30a14e; }
      .level-4 { fill: #216e39; }
      .scanner-line { stroke: #1f883d; }
      .scanner-stop { stop-color: #2da44e; }

      @media (prefers-color-scheme: dark) {
        .base-cell { fill: #161b22; stroke: #30363d; }
        .level-1 { fill: #0e4429; }
        .level-2 { fill: #006d32; }
        .level-3 { fill: #26a641; }
        .level-4 { fill: #39d353; }
        .scanner-line { stroke: #7ee787; }
        .scanner-stop { stop-color: #39d353; }
      }
    </style>

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
  </defs>

  <g id="base-grid" shape-rendering="geometricPrecision">
${renderBaseGrid(weekCount)}
  </g>

  <g id="revealed-contributions" clip-path="url(#reveal-clip)" shape-rendering="geometricPrecision">
${renderContributionGrid(contributions)}
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
