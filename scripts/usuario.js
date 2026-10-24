// Uso: node scripts/usuario.js <usuario> <clave>   (crea o cambia un usuario de administración)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [user, pass] = process.argv.slice(2);
if (!/^[a-z0-9]{3,30}$/.test(user || '') || !pass) {
  console.error('Uso: node scripts/usuario.js <usuario en minúsculas sin espacios> <clave>');
  process.exit(1);
}
const file = path.join(__dirname, '..', 'usuarios.json');
let users = {};
try { users = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
const salt = crypto.randomBytes(16).toString('hex');
users[user] = { salt, hash: crypto.scryptSync(pass, salt, 32).toString('hex') };
fs.writeFileSync(file, JSON.stringify(users, null, 2) + '\n');
console.log(`Usuario "${user}" guardado.`);
