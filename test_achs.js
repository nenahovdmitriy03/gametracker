const https = require('https');

https.get('https://steamcommunity.com/stats/3357650/achievements?l=english', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const rows = data.match(/<div class="achieveRow.*?>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g);
    if (rows && rows.length > 0) {
      console.log('Found rows:', rows.length);
      console.log(rows[0]);
    } else {
      console.log('No rows found. Here is the start of the page:', data.substring(0, 500));
    }
  });
}).on('error', (err) => {
  console.log('Error:', err.message);
});