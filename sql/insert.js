import mysql from 'mysql2';
import fs from 'fs';

// Read wallets.json file
const wallets = JSON.parse(fs.readFileSync('../wallets.json', 'utf8'));

// Create MySQL connection
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'ledge',
  password: 'hfLEsAtStG4LzETZ',
  database: 'ledge'
});

connection.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL database.');

  // Create wallets table if it doesn't exist
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS wallets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      address VARCHAR(42) NOT NULL UNIQUE,
      privateKey VARCHAR(66) NOT NULL,
      mnemonic TEXT NOT NULL
    )
  `;
  connection.query(createTableQuery, err => {
    if (err) throw err;
    console.log('Table wallets ensured.');

    // Insert wallets data into database
    let completedQueries = 0;
    wallets.forEach(wallet => {
      const { address, privateKey, mnemonic } = wallet;
      const checkQuery = 'SELECT COUNT(*) AS count FROM wallets WHERE address = ?';
      connection.query(checkQuery, [address], (err, results) => {
        if (err) throw err;
        if (results[0].count === 0) {
          const insertQuery = 'INSERT INTO wallets (address, privateKey, mnemonic) VALUES (?, ?, ?)';
          connection.query(insertQuery, [address, privateKey, mnemonic], (err, result) => {
            if (err) throw err;
            console.log(`Wallet with address ${address} inserted.`);
            completedQueries++;
            if (completedQueries === wallets.length) {
              connection.end();
            }
          });
        } else {
          console.log(`Wallet with address ${address} already exists.`);
          completedQueries++;
          if (completedQueries === wallets.length) {
            connection.end();
          }
        }
      });
    });
  });
});
