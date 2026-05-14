const files = $('Code - Diff GitHub Files').all();

return files.filter((item) => item.json.action !== 'skip');
