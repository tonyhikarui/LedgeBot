import mysql from 'mysql2/promise';
import log from './logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DB_CONFIG = {
  host: 'localhost',
  user: 'ledge',
  password: 'hfLEsAtStG4LzETZ',
  database: 'ledge',
  waitForConnections: true,
  connectionLimit: 100,
  queueLimit: 0,
  connectTimeout: 30000, // Increased timeout
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  multipleStatements: true
};

async function checkMySQLService() {
    try {
        const { stdout } = await execAsync('systemctl is-active mysql');
        return stdout.trim() === 'active';
    } catch (error) {
        log.error('MySQL service check failed:', error.message);
        return false;
    }
}

async function startMySQLService() {
    try {
        await execAsync('sudo systemctl start mysql');
        log.info('MySQL service started successfully');
        return true;
    } catch (error) {
        log.error('Failed to start MySQL service:', error.message);
        return false;
    }
}

async function createPool() {
    const maxRetries = 5;
    const retryDelay = 10000; // 10 seconds

    for (let i = 0; i < maxRetries; i++) {
        try {
            // Check MySQL service status
            const isActive = await checkMySQLService();
            if (!isActive) {
                log.warn('MySQL service is not running, attempting to start...');
                await startMySQLService();
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for service to start
            }

            const pool = mysql.createPool(DB_CONFIG);
            const conn = await pool.getConnection();
            await conn.ping(); // Test the connection
            conn.release();
            
            log.info('Database connected successfully');
            return pool;
        } catch (error) {
            const retryCount = i + 1;
            log.error(`Database connection attempt ${retryCount}/${maxRetries} failed:`, error.message);
            
            if (retryCount === maxRetries) {
                log.error('All connection attempts failed. Please check:');
                log.error('1. MySQL service status (systemctl status mysql)');
                log.error('2. Database credentials');
                log.error('3. Database existence');
                log.error('4. Network connectivity');
                throw new Error(`Database connection failed after ${maxRetries} attempts: ${error.message}`);
            }

            log.info(`Retrying in ${retryDelay/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

// Initialize pool with error handling
let pool;
try {
    pool = await createPool();
} catch (error) {
    log.error('Failed to initialize database pool:', error.message);
    process.exit(1);
}

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
