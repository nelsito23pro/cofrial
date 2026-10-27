// Conexión a Amazon RDS (MySQL 8) mediante un pool de conexiones
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "cofrial_db",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,       // las fechas llegan como texto 'YYYY-MM-DD HH:MM:SS'
  decimalNumbers: true,    // DECIMAL -> number
  timezone: "local",
});

// Zona horaria de la sesión: todas las fechas (NOW(), CURDATE()) quedan en hora de Chile.
// En RDS se puede usar "America/Santiago"; "-03:00" funciona en cualquier servidor MySQL.
const TZ = process.env.DB_TIMEZONE || "-03:00";
pool.on("connection", (conn) => conn.query("SET time_zone = ?", [TZ]));

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Ejecuta una función dentro de una transacción (commit / rollback automático)
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, transaction };
