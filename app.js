const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function runWithConcurrency(items, maxConcurrent, fn) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const p = fn(item);
    results.push(p);

    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
    }

    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
  }

  return Promise.all(results);
}

async function getSitesFromAPI() {
  const apiUrl = 'https://metacms.highstakes.tech/api/repotable-domains-by-org/highstakes/';
  try {
    const response = await axios.get(apiUrl);
    return response.data;
  } catch (error) {
    console.error(`Erro ao buscar sites da API: ${error.message}`);
    return [];
  }
}

function setLanguageUrl(baseUrl, language) {
  return `${baseUrl.replace(/\/$/, '')}/${language}/`;
}
//pega links da nav e do footer 
async function getNavAndFooterUrls(page, baseUrl) {
  const baseOrigin = new URL(baseUrl).origin;

  const navLinks = await page.$$eval('nav a[href], ul a[href], ol a[href]', anchors =>
    anchors.map(a => a.href.trim())
  );

  const footerLinks = await page.$$eval('footer a[href]', anchors =>
    anchors.map(a => a.href.trim())
  );

  const allLinks = new Set(
    [...navLinks, ...footerLinks].filter(href => {
      try {
        return new URL(href).origin === baseOrigin;
      } catch {
        return false;
      }
    })
  );

  return [...allLinks];
}

function addLanguageSummary(results, language, url, status) {
  if (!results.languageSummary[language]) {
    results.languageSummary[language] = { success: [], error: [], emptyContent: [] };
  }
  results.languageSummary[language][status].push(url);
}

async function testPageUrl(page, url, siteUrl, language, errorPages, emptyContentPages, testedUrls, results) {
  if (testedUrls.has(url)) {
    console.warn(`URL já testada, pulando: ${url}`);
    return;
  }
  testedUrls.add(url);
  results.urlsTested.add(url);

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    if (!response || response.status() >= 400) {
  const status = response ? response.status() : 'No Response';

  if (status === 404) {
        console.error(`Erro HTTP 404 em ${url}`);
      } else {
        console.error(`Erro HTTP ${status} em ${url}`);
      }
      
  console.error(`Erro HTTP ${status} em ${url}`);
  errorPages.push(url);
  results.errors.push(url);
  addLanguageSummary(results, language, url, 'error');
  return;
}

    const hasContent = await page.evaluate(() => {
      const selectors = ['.popularCate', '.main-content', 'article', 'section.content'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 20) return true;
      }
      return document.body.innerText.trim().length > 50;
    });

    if (!hasContent) {
      console.warn(`Conteúdo insuficiente em ${url}`);
      emptyContentPages.push(url);
      results.emptyContent.push(url);
      addLanguageSummary(results, language, url, 'emptyContent');
    } else {
      results.success.push(url);
      addLanguageSummary(results, language, url, 'success');
    }
  } catch (error) {
    console.error(`Erro ao testar ${url}: ${error.message}`);
    errorPages.push(url);
    results.errors.push(url);
    addLanguageSummary(results, language, url, 'error');
  }
}

async function testSite(site, results) {
  const browser = await puppeteer.launch({ headless: false });
  const errorPages = [];
  const emptyContentPages = [];
  const testedUrls = new Set();

  const testLanguage = async (language) => {
    const page = await browser.newPage();
    await page.setViewport({
      width: 375,
      height: 667,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    const languageUrl = setLanguageUrl(site.url, language);
    await testPageUrl(page, languageUrl, site.url, language, errorPages, emptyContentPages, testedUrls, results);

    const navFooterUrls = await getNavAndFooterUrls(page, languageUrl);
    for (const url of navFooterUrls) {
      if (!testedUrls.has(url)) {
        await testPageUrl(page, url, site.url, language, errorPages, emptyContentPages, testedUrls, results);
      }
    }

    await page.close();
  };

  await runWithConcurrency(site.languages, 5, testLanguage);

  await browser.close();

  return { errorPages, emptyContentPages };
}

async function testAllSites(sites) {
  const results = {
    urlsTested: new Set(),
    success: [],
    emptyContent: [],
    errors: [],
    languageSummary: {}
  };

  const testedSitesReport = [];

  const MAX_CONCURRENT_BROWSERS = 1;

  await runWithConcurrency(sites, MAX_CONCURRENT_BROWSERS, async (site) => {
    console.log(`Iniciando testes para: ${site.url}`);
    const { errorPages, emptyContentPages } = await testSite(site, results);

    testedSitesReport.push({
      url: site.url,
      languagesTested: site.languages,
      errorPages,
      emptyContentPages,
      status: 'Testado com sucesso',
    });

    console.log(`Finalizado testes para: ${site.url}`);
  });

  // Converte Set para Array para salvar JSON
  results.urlsTested = Array.from(results.urlsTested);

  // Salvar relatórios
  const reportDir = path.resolve(__dirname, 'report');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  fs.writeFileSync(path.join(reportDir, 'tested_sites.json'), JSON.stringify(testedSitesReport, null, 2));
  fs.writeFileSync(path.join(reportDir, 'error_pages.json'), JSON.stringify(results.errors, null, 2));
  fs.writeFileSync(path.join(reportDir, 'empty_content_pages.json'), JSON.stringify(results.emptyContent, null, 2));
  fs.writeFileSync(path.join(reportDir, 'test_report.json'), JSON.stringify(results, null, 2));

  console.log('Relatórios salvos em /report');
}

module.exports = { getSitesFromAPI, testAllSites };