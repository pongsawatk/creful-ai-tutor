const files = $('Code - Diff GitHub Files').all().map((item) => item.json);

return [
  {
    json: {
      has_writes: files.some((file) => file.action !== 'skip')
    }
  }
];
