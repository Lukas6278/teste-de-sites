const { getSitesFromAPI, testAllSites } = require('../app');

(async () => {
  const domains = await getSitesFromAPI();

  if (domains.length === 0) {
    console.error('Nenhum site encontrado para testar.');
    return;
  }

  // Ajuste para garantir que cada domínio tenha idiomas definidos
  const sites = domains.map(domain => ({
    url: domain.startsWith('http') ? domain : `https://${domain}`,
    languages: ['en', 'pt', 'es', 'de', 'fr'],
  }));

  await testAllSites(sites);

  console.log('Todos os testes finalizados.');
})();