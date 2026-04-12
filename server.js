const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https'); // 🟢 AJOUT : Le module HTTPS
const { Server } = require('socket.io');

const app = express();

// 🟢 CONFIGURATION SSL : Chargement des certificats copiés dans ton dossier
const sslOptions = {
    key: fs.readFileSync('./privkey.pem'),
    cert: fs.readFileSync('./fullchain.pem')
};

// 🟢 MODIFICATION : On utilise https.createServer au lieu de http
const server = https.createServer(sslOptions, app);
const io = new Server(server);

// 🟢 MODIFICATION : Le port HTTPS standard est le 443
const PORT_HTTPS = process.env.APP_HTTPS_PORT || 443; 
const PORT_HTTP= process.env.APP_HTTP_PORT || 80;
const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const obtenirHeure = () => new Date().toLocaleTimeString('fr-FR');
const logInfo = (msg) => console.log(`\x1b[36m[${obtenirHeure()}] 🔵 INFO :\x1b[0m ${msg}`);
const logAjout = (msg) => console.log(`\x1b[32m[${obtenirHeure()}] 🟢 AJOUT :\x1b[0m ${msg}`);
const logModif = (msg) => console.log(`\x1b[33m[${obtenirHeure()}] 🟠 MODIF :\x1b[0m ${msg}`);
const logSuppr = (msg) => console.log(`\x1b[31m[${obtenirHeure()}] 🔴 ALERTE :\x1b[0m ${msg}`);

function getClientIp(reqOrSocket) {
    let ip = "IP Inconnue";
    if (reqOrSocket.headers && reqOrSocket.headers['x-forwarded-for']) { ip = reqOrSocket.headers['x-forwarded-for'].split(',')[0]; } 
    else if (reqOrSocket.handshake && reqOrSocket.handshake.headers['x-forwarded-for']) { ip = reqOrSocket.handshake.headers['x-forwarded-for'].split(',')[0]; } 
    else if (reqOrSocket.connection && reqOrSocket.connection.remoteAddress) { ip = reqOrSocket.connection.remoteAddress; } 
    else if (reqOrSocket.handshake && reqOrSocket.handshake.address) { ip = reqOrSocket.handshake.address; } 
    else if (reqOrSocket.ip) { ip = reqOrSocket.ip; }
    if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];
    return ip;
}

// 📁 GESTION DE LA CONFIGURATION (Catégories)
function lireConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        const defaultConfig = {
            categories: ["Hôpital / Asile", "Usine / Industriel", "Château / Manoir", "Bunker / Militaire", "Souterrain / Catacombes", "Résidentiel", "Religieux", "Autre"]
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

function lireDonnees() {
    if (!fs.existsSync(DATA_FILE)) { fs.writeFileSync(DATA_FILE, JSON.stringify([])); }
    return JSON.parse(fs.readFileSync(DATA_FILE));
}
function sauvegarderDonnees(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let utilisateursConnectes = 0;
let squadPlayers = {}; 

io.on('connection', (socket) => {
    const ip = getClientIp(socket); utilisateursConnectes++; logInfo(`Agent connecté depuis [${ip}]. (En ligne : ${utilisateursConnectes})`);
    socket.on('chat_message', (msg) => { logInfo(`💬 [${ip}] Radio : ${msg}`); io.emit('chat_message', msg); });
    socket.on('sos_alert', (data) => { logSuppr(`🚨 S.O.S DÉCLENCHÉ PAR [${ip}] : ${data.lat}, ${data.lng}`); io.emit('sos_alert', data); });
    socket.on('ping_tactique', (data) => { io.emit('ping_tactique', data); });
    socket.on('player_move', (data) => {
        if (!squadPlayers[socket.id]) { squadPlayers[socket.id] = { trace: [], ip: ip }; }
        squadPlayers[socket.id].lat = data.lat; squadPlayers[socket.id].lng = data.lng; squadPlayers[socket.id].name = data.name; squadPlayers[socket.id].heading = data.heading;
        squadPlayers[socket.id].trace.push([data.lat, data.lng]); if (squadPlayers[socket.id].trace.length > 80) squadPlayers[socket.id].trace.shift(); 
        io.emit('squad_update', squadPlayers);
    });
    socket.on('disconnect', () => { utilisateursConnectes--; logInfo(`Agent déconnecté [${ip}].`); delete squadPlayers[socket.id]; io.emit('squad_update', squadPlayers); });
});

app.get('/api/config', (req, res) => { res.json(lireConfig()); });
app.get('/api/markers', (req, res) => { res.json(lireDonnees()); });
app.post('/api/markers', (req, res) => {
    const ip = getClientIp(req); const points = lireDonnees(); const nouveauPoint = { id: Date.now().toString(), ...req.body };
    points.push(nouveauPoint); sauvegarderDonnees(points); logAjout(`Spot "${nouveauPoint.nom}" créé par [${ip}].`);
    io.emit('marker_added', nouveauPoint); res.json(nouveauPoint);
});
app.put('/api/markers/:id', (req, res) => {
    const ip = getClientIp(req); const points = lireDonnees(); const index = points.findIndex(p => p.id === req.params.id);
    if (index !== -1) { points[index] = { ...points[index], ...req.body }; sauvegarderDonnees(points); logModif(`Spot "${points[index].nom}" MAJ par [${ip}].`); io.emit('marker_edited', points[index]); res.json(points[index]); } 
    else { res.status(404).send('Non trouvé'); }
});
app.delete('/api/markers/:id', (req, res) => {
    const ip = getClientIp(req); let points = lireDonnees(); const p = points.find(p => p.id === req.params.id);
    if (p) { points = points.filter(x => x.id !== req.params.id); sauvegarderDonnees(points); logSuppr(`Spot "${p.nom}" SUPPRIMÉ par [${ip}].`); io.emit('marker_deleted', req.params.id); }
    res.json({ success: true });
});

// 🟢 AJOUT : Serveur HTTP "miroir" pour forcer la redirection vers HTTPS
http.createServer((req, res) => {
    res.writeHead(301, { "Location": "https://ananasloll3.online" + req.url });
    res.end();
}).listen(PORT_HTTP, () => {
    console.log(`\x1b[43m\x1b[30m 🔄 Redirection HTTP -> HTTPS activée sur le port 80 \x1b[0m`);
});

// 🟢 MODIFICATION : Lancement du serveur principal sur le port HTTPS (443)
server.listen(PORT_HTTPS, () => { 
    console.log(`\x1b[42m\x1b[30m 🌍 Serveur Command Center lancé sur https://ananasloll3.online \x1b[0m\n`); 
});
