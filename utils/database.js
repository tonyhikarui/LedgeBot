import mysql from 'mysql2/promise';
import log from './logger.js';

const DB_CONFIG = {
  host: 'localhost',
  user: 'ledge',
  password: 'hfLEsAtStG4LzETZ',
  database: 'ledge',
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

async function createPool() {
  for (let i = 0; i < 3; i++) {
    try {
      const pool = mysql.createPool(DB_CONFIG);
      // Test the connection
      await pool.getConnection();
      log.info('Database connected successfully');
      return pool;
    } catch (error) {
      log.error(`Database connection attempt ${i + 1} failed:`, error.message);
      if (i === 2) {
        log.error('Could not connect to database after 3 attempts. Please check if MySQL is running.');
        throw new Error('Database connection failed: ' + error.message);
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
    }
  }
}

const pool = await createPool();

export async function updateWalletProof(address, proofValue) {
  try {
    const connection = await pool.getConnection();
    try {
      const [result] = await connection.execute(
        'UPDATE wallets SET proof = ? WHERE address = ?',
        [proofValue, address]
      );
      return result.affectedRows > 0;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Error updating proof for wallet ${address}:`, error);
    throw error;
  }
}

export async function checkWalletProof(address) {
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute(
        'SELECT proof FROM wallets WHERE address = ?',
        [address]
      );
      return rows[0]?.proof;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`Error checking proof for wallet ${address}:`, error);
    throw error;
  }
}

// Add any other database functions here...

export default pool;
