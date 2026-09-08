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

// Öne çıkarılması istenen 15 temel proje (en az 12 tanesi listelenir)
const PRIORITY_REPOS = [
  'Indirgitsin',
  'MyFinans',
  'VoltGet',
  'PdfStudio',
  'Ocr-Capture',
  'EzanApp',
  'KozaRcCar',
  'algoflow',
  'optikdegerlendirme',
  'kozaders',
  'learnnSql',
  'blutoothwithclassicsandble',
  'calculatorwithelectron',
  'Postaci',
  'KozaBluetooh'
];

const CUSTOM_DESCRIPTIONS = {
  'indirgitsin': 'Kotlin ve Jetpack Compose ile Android video/ses indirme yöneticisi. Paralel aktarım, sesli video birleştirme ve kalıcı kuyruk.',
  'myfinans': '💰 React + Capacitor mobil/web arayüzü ve Node.js backend ile kişisel finans takibi. Bütçe, kredi kartı ve taksit yönetimi.',
  'voltget': '⚡ Ultra hızlı çok kanallı (8-thread) indirme yöneticisi ve akıllı medya yakalayıcı. Electron, React ve yt-dlp destekli IDM alternatifi.',
  'pdfstudio': '🚀 %100 çevrimdışı PDF düzenleme paketi — Tauri 2 (Rust) + React 19, OCR ve Word/Excel dışa aktarma araçları.',
  'ocr-capture': '⚡ Ekranınızdan ışık hızında, çevrimdışı ve akıllı metin ayıklama aracı. Tauri v2, Rust ve Tesseract OCR ile masaüstü ekran alıntısı çözümü.',
  'ezanapp': '🕌 Islamic prayer times & customizable reminder app built with Flutter (namaz vakitleri ve ezan bildirimleri).',
  'kozarccar': '🏎️ HC-05/06 ve BLE destekli, telemetri, seri monitör ve kokpit arayüzlü gelişmiş Flutter RC model araç ve robot kontrol uygulaması.',
  'algoflow': '⚡ Sürükle-bırak algoritma & akış şeması stüdyosu: canlı yorumlayıcı + 6 farklı dile kod üretimi.',
  'optikdegerlendirme': '📋 Optik form okuma ve sınav değerlendirme için WPF masaüstü uygulaması (OMR).',
  'kozaders': '🎓 Laravel + Tailwind CSS ve Blade mimarisi ile geliştirilen Koza Ders eğitim ve öğrenim platformu.',
  'learnnsql': '📊 İnteraktif SQL öğrenme, veritabanı sorgulama ve pratik yapma platformu.',
  'blutoothwithclassicsandble': '📡 Flutter ile Bluetooth Classic ve BLE (Düşük Enerji) haberleşme kütüphanesi & örnekleri.',
  'calculatorwithelectron': '🧮 Electron ve JavaScript altyapısıyla geliştirilmiş modern masaüstü hesap makinesi uygulaması.',
  'postaci': '📬 Modern API test ve HTTP istek yönetim aracı (geliştirici odaklı Postman alternatifi).',
  'kozabluetooh': '📶 C# ve .NET ile Bluetooth cihaz haberleşme, bağlantı yönetimi ve veri aktarım arayüzü.'
};

const CUSTOM_LANGUAGES = {
  'indirgitsin': 'Kotlin',
  'kozaders': 'PHP',
  'calculatorwithelectron': 'JavaScript',
  'voltget': 'TypeScript'
};

const CUSTOM_HOMEPAGES = {
  'indirgitsin': 'https://github.com/eekilinc/indirgitsin/releases/latest'
};

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

  // Yıllara göre toplam commit ve katkı sayısını hesapla
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
  const ownRepos = reposRest.filter(r => !r.fork && r.name.toLowerCase() !== USERNAME.toLowerCase());
  const totalStars = ownRepos.reduce((acc, r) => acc + (r.stargazers_count || 0), 0);

  // Havuzdaki tüm aday repoları topla
  const repoMap = new Map();

  // Önceki verilerden aktar
  if (prevData?.repos) {
    for (const r of prevData.repos) {
      repoMap.set(r.name.toLowerCase(), r);
    }
  }

  // REST API'deki repoları haritaya ekle
  for (const r of ownRepos) {
    const key = r.name.toLowerCase();
    let lang = CUSTOM_LANGUAGES[key] || r.language || "";

    repoMap.set(key, {
      name: r.name,
      html_url: r.html_url,
      description: r.description || CUSTOM_DESCRIPTIONS[key] || "Açıklama eklenmedi.",
      language: lang,
      stargazers_count: r.stargazers_count || 0,
      forks_count: r.forks_count || 0,
      pushed_at: r.pushed_at,
      topics: r.topics || [],
      homepage: r.homepage || CUSTOM_HOMEPAGES[key] || ""
    });
  }

  // GraphQL pinned repolarını haritaya ekle/güncelle
  if (gqlData?.pinnedRepos) {
    for (const node of gqlData.pinnedRepos) {
      const key = node.name.toLowerCase();
      let lang = CUSTOM_LANGUAGES[key] || node.primaryLanguage?.name || "";

      repoMap.set(key, {
        name: node.name,
        html_url: node.url,
        description: node.description || CUSTOM_DESCRIPTIONS[key] || "Açıklama eklenmedi.",
        language: lang,
        stargazers_count: node.stargazerCount || 0,
        forks_count: node.forkCount || 0,
        pushed_at: node.pushedAt,
        topics: (node.repositoryTopics?.nodes || []).map(n => n.topic.name),
        homepage: node.homepageUrl || CUSTOM_HOMEPAGES[key] || ""
      });
    }
  }

  // Son repo listesini oluştur: Öncelikli repolar başta, diğerleri sırayla
  const finalRepos = [];
  const addedNames = new Set();

  // 1. Öncelikli 15 repoyu ekle
  for (const name of PRIORITY_REPOS) {
    const key = name.toLowerCase();
    if (repoMap.has(key)) {
      const item = repoMap.get(key);
      if (!item.description || item.description === "Açıklama eklenmedi.") {
        item.description = CUSTOM_DESCRIPTIONS[key] || item.description;
      }
      finalRepos.push(item);
      addedNames.add(key);
    }
  }

  // 2. Kalan repoları da ekle (en az 14 repoya kadar)
  const remaining = Array.from(repoMap.values())
    .filter(r => !addedNames.has(r.name.toLowerCase()))
    .sort((a, b) => (b.stargazers_count - a.stargazers_count) || (new Date(b.pushed_at) - new Date(a.pushed_at)));

  for (const r of remaining) {
    if (finalRepos.length >= 14) break;
    const key = r.name.toLowerCase();
    if (!r.description || r.description === "Açıklama eklenmedi.") {
      r.description = CUSTOM_DESCRIPTIONS[key] || r.description;
    }
    finalRepos.push(r);
  }

  // Commit sayısı hesaplama
  let formattedCommits = prevData?.user?.total_commits || "560+";
  if (gqlData?.totalCommits && gqlData.totalCommits > 0) {
    const c = gqlData.totalCommits;
    formattedCommits = `${c}+`;
  }

  const output = {
    updated_at: new Date().toISOString(),
    user: {
      login: USERNAME,
      name: userRest?.name || gqlData?.user?.name || prevData?.user?.name || "Ekrem Eşref KILINÇ",
      avatar_url: userRest?.avatar_url || `https://avatars.githubusercontent.com/${USERNAME}`,
      html_url: `https://github.com/${USERNAME}`,
      public_repos: userRest?.public_repos ?? prevData?.user?.public_repos ?? 19,
      followers: userRest?.followers ?? gqlData?.user?.followers?.totalCount ?? prevData?.user?.followers ?? 36,
      total_stars: totalStars, // Gerçek alınan toplam yıldız sayısı (0 ise 0 gösterir, yapay 17 göstermez)
      total_commits: formattedCommits
    },
    repos: finalRepos
  };

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`[Sync] Successfully updated ${OUTPUT_FILE}`);
  console.log(`[Sync] Repos count: ${output.repos.length}, Total Commits: ${output.user.total_commits}, Total Stars: ${output.user.total_stars}`);
  console.log(`[Sync] Featured Repos: ${output.repos.map(r => r.name).join(', ')}`);
}

main().catch(err => {
  console.error('[Sync] Fatal error:', err);
  process.exit(1);
});
