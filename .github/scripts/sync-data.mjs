// .github/scripts/sync-data.mjs
// GitHub Actions tarafından düzenli olarak çalıştırılıp verileri data/github.json dosyasına senkronize eder.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const OUTPUT_FILE = path.join(ROOT_DIR, 'data/github.json');

const USERNAME = 'eekilinc';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const headers = {
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'eekilinc-github-sync-bot'
};
if (TOKEN) {
  headers['Authorization'] = `Bearer ${TOKEN}`;
}

async function fetchGraphQL(query, variables = {}) {
  if (!TOKEN) return null;
  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'eekilinc-github-sync-bot'
      },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) {
      console.warn(`[GraphQL] HTTP error ${res.status}: ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    if (data.errors) {
      console.warn('[GraphQL] Response errors:', data.errors);
      return null;
    }
    return data.data;
  } catch (err) {
    console.warn('[GraphQL] Request failed:', err.message);
    return null;
  }
}

async function getGraphQLData() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        name
        login
        avatarUrl
        url
        bio
        createdAt
        followers {
          totalCount
        }
        pinnedItems(first: 6, types: [REPOSITORY]) {
          nodes {
            ... on Repository {
              name
              url
              description
              homepageUrl
              stargazerCount
              forkCount
              pushedAt
              primaryLanguage {
                name
                color
              }
              repositoryTopics(first: 5) {
                nodes {
                  topic {
                    name
                  }
                }
              }
            }
          }
        }
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;

  const data = await fetchGraphQL(query, { login: USERNAME });
  if (!data?.user) return null;

  let totalCommits = 0;
  const years = data.user.contributionsCollection?.contributionYears || [];

  // Yıllara göre toplam commit sayısını hesapla
  for (const year of years) {
    const yearQuery = `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            restrictedContributionsCount
          }
        }
      }
    `;
    const from = `${year}-01-01T00:00:00Z`;
    const to = `${year}-12-31T23:59:59Z`;
    const yearData = await fetchGraphQL(yearQuery, { login: USERNAME, from, to });
    if (yearData?.user?.contributionsCollection) {
      const { totalCommitContributions, restrictedContributionsCount } = yearData.user.contributionsCollection;
      totalCommits += (totalCommitContributions || 0) + (restrictedContributionsCount || 0);
    }
  }

  return {
    user: data.user,
    totalCommits,
    pinnedRepos: data.user.pinnedItems?.nodes || []
  };
}

async function main() {
  console.log(`[Sync] Starting GitHub data synchronization for ${USERNAME}...`);

  let prevData = null;
  try {
    const raw = await fs.readFile(OUTPUT_FILE, 'utf-8');
    prevData = JSON.parse(raw);
  } catch {
    console.log('[Sync] No previous data file found.');
  }

  // 1. Kullanıcı REST API
  let userRest = null;
  try {
    const userRes = await fetch(`https://api.github.com/users/${USERNAME}`, { headers });
    if (userRes.ok) {
      userRest = await userRes.json();
    } else {
      console.warn(`[REST] Users API returned ${userRes.status}`);
    }
  } catch (err) {
    console.warn('[REST] User fetch failed:', err.message);
  }

  // 2. Repolar REST API
  let reposRest = [];
  try {
    const reposRes = await fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`, { headers });
    if (reposRes.ok) {
      const json = await reposRes.json();
      if (Array.isArray(json)) reposRest = json;
    } else {
      console.warn(`[REST] Repos API returned ${reposRes.status}`);
    }
  } catch (err) {
    console.warn('[REST] Repos fetch failed:', err.message);
  }

  // 3. GraphQL (Token varsa Pinned Repolar & Total Commits)
  const gqlData = await getGraphQLData();

  // Hesaplamalar
  const ownRepos = reposRest.filter(r => !r.fork && r.name !== USERNAME);
  const totalStars = ownRepos.reduce((acc, r) => acc + (r.stargazers_count || 0), 0);

  let finalRepos = [];
  if (gqlData?.pinnedRepos && gqlData.pinnedRepos.length > 0) {
    finalRepos = gqlData.pinnedRepos.map(node => ({
      name: node.name,
      html_url: node.url,
      description: node.description || "Açıklama eklenmedi.",
      language: node.primaryLanguage?.name || "",
      stargazers_count: node.stargazerCount || 0,
      forks_count: node.forkCount || 0,
      pushed_at: node.pushedAt,
      topics: (node.repositoryTopics?.nodes || []).map(n => n.topic.name),
      homepage: node.homepageUrl || ""
    }));
  } else if (ownRepos.length > 0) {
    const top = [...ownRepos].sort((a, b) =>
      (b.stargazers_count - a.stargazers_count) || (new Date(b.pushed_at) - new Date(a.pushed_at))
    ).slice(0, 6);

    finalRepos = top.map(r => ({
      name: r.name,
      html_url: r.html_url,
      description: r.description || "Açıklama eklenmedi.",
      language: r.language || "",
      stargazers_count: r.stargazers_count || 0,
      forks_count: r.forks_count || 0,
      pushed_at: r.pushed_at,
      topics: r.topics || [],
      homepage: r.homepage || ""
    }));
  } else if (prevData?.repos) {
    finalRepos = prevData.repos;
  }

  let formattedCommits = prevData?.user?.total_commits || "1.3K+";
  if (gqlData?.totalCommits && gqlData.totalCommits > 0) {
    const c = gqlData.totalCommits;
    formattedCommits = c >= 1000 ? `${(c / 1000).toFixed(1)}K+` : `${c}+`;
  }

  const output = {
    updated_at: new Date().toISOString(),
    user: {
      login: USERNAME,
      name: userRest?.name || gqlData?.user?.name || prevData?.user?.name || "Ekrem Eşref KILINÇ",
      avatar_url: userRest?.avatar_url || `https://avatars.githubusercontent.com/${USERNAME}`,
      html_url: `https://github.com/${USERNAME}`,
      public_repos: userRest?.public_repos ?? prevData?.user?.public_repos ?? ownRepos.length,
      followers: userRest?.followers ?? gqlData?.user?.followers?.totalCount ?? prevData?.user?.followers ?? 36,
      total_stars: totalStars > 0 ? totalStars : (prevData?.user?.total_stars ?? 17),
      total_commits: formattedCommits
    },
    repos: finalRepos
  };

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`[Sync] Successfully updated ${OUTPUT_FILE}`);
  console.log(`[Sync] Repos count: ${output.repos.length}, Total Commits: ${output.user.total_commits}`);
}

main().catch(err => {
  console.error('[Sync] Fatal error:', err);
  process.exit(1);
});
