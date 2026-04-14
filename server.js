const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

// ─────────────────────────────────────────────
//  ENVIRONNEMENT
// ─────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';
const ENV_LABEL = IS_PROD ? '🟢 PROD' : '🟡 DEV';

console.log(`\x1b[1m[CONFIG] Démarrage en mode : ${ENV_LABEL}\x1b[0m`);

// ─────────────────────────────────────────────
//  CONFIGURATION PAR ENVIRONNEMENT
// ─────────────────────────────────────────────
const config = IS_PROD
    ? {
        // — PRODUCTION —
        port: process.env.APP_HTTPS_PORT || 443,
        portHttp: process.env.APP_HTTP_PORT || 80,
        useHttps: true,
        domain: 'https://ananasloll3.online',
        sslKey: './privkey.pem',
        sslCert: './fullchain.pem',
    }
    : {
        // — DÉVELOPPEMENT —
        port: process.env.APP_PORT || 3000,
        portHttp: null,       // pas de redirection HTTP en dev
        useHttps: false,
        domain: 'http://localhost',
        sslKey: null,
        sslCert: null,
    };

// ─────────────────────────────────────────────
//  CHEMINS DES FICHIERS DE DONNÉES
// ─────────────────────────────────────────────
const DATA_FILE   = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ─────────────────────────────────────────────
//  APPLICATION EXPRESS
// ─────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// ─────────────────────────────────────────────
//  CRÉATION DU SERVEUR (HTTP ou HTTPS)
// ─────────────────────────────────────────────
let server;

if (config.useHttps) {
    const sslOptions = {
        key:  fs.readFileSync(config.sslKey),
        cert: fs.readFileSync(config.sslCert),
    };
    server = https.createServer(sslOptions, app);
} else {
    server = http.createServer(app);
}

const io = new Server(server);

// ─────────────────────────────────────────────
//  LOGS COLORÉS
// ─────────────────────────────────────────────
const obtenirHeure = () => new Date().toLocaleTimeString('fr-FR');
const logInfo  = (msg) => console.log(`\x1b[36m[${obtenirHeure()}] 🔵 INFO :\x1b[0m ${msg}`);
const logAjout = (msg) => console.log(`\x1b[32m[${obtenirHeure()}] 🟢 AJOUT :\x1b[0m ${msg}`);
const logModif = (msg) => console.log(`\x1b[33m[${obtenirHeure()}] 🟠 MODIF :\x1b[0m ${msg}`);
const logSuppr = (msg) => console.log(`\x1b[31m[${obtenirHeure()}] 🔴 ALERTE :\x1b[0m ${msg}`);

// ─────────────────────────────────────────────
//  UTILITAIRE : IP CLIENT
// ─────────────────────────────────────────────
function getClientIp(reqOrSocket) {
    let ip = 'IP Inconnue';
    if (reqOrSocket.headers?.['x-forwarded-for'])                   ip = reqOrSocket.headers['x-forwarded-for'].split(',')[0];
    else if (reqOrSocket.handshake?.headers['x-forwarded-for'])     ip = reqOrSocket.handshake.headers['x-forwarded-for'].split(',')[0];
    else if (reqOrSocket.connection?.remoteAddress)                  ip = reqOrSocket.connection.remoteAddress;
    else if (reqOrSocket.handshake?.address)                        ip = reqOrSocket.handshake.address;
    else if (reqOrSocket.ip)                                        ip = reqOrSocket.ip;
    if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];
    return ip;
}

// ─────────────────────────────────────────────
//  DONNÉES : CONFIG & MARKERS
// ─────────────────────────────────────────────
function lireConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        const defaultConfig = {
            categories: [
                'Hôpital / Asile', 'Usine / Industriel', 'Château / Manoir',
                'Bunker / Militaire', 'Souterrain / Catacombes',
                'Résidentiel', 'Religieux', 'Autre',
            ],
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

function lireDonnees() {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

function sauvegarderDonnees(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────
//  SOCKET.IO
// ─────────────────────────────────────────────
let utilisateursConnectes = 0;
let squadPlayers = {};

io.on('connection', (socket) => {
    const ip = getClientIp(socket);
    utilisateursConnectes++;
    logInfo(`Agent connecté depuis [${ip}]. (En ligne : ${utilisateursConnectes})`);

    socket.on('chat_message', (msg) => {
        logInfo(`💬 [${ip}] Radio : ${msg}`);
        io.emit('chat_message', msg);
    });

    socket.on('sos_alert', (data) => {
        logSuppr(`🚨 S.O.S DÉCLENCHÉ PAR [${ip}] : ${data.lat}, ${data.lng}`);
        io.emit('sos_alert', data);
    });

    socket.on('ping_tactique', (data) => {
        io.emit('ping_tactique', data);
    });

    socket.on('player_move', (data) => {
        if (!squadPlayers[socket.id]) squadPlayers[socket.id] = { trace: [], ip };
        const p = squadPlayers[socket.id];
        p.lat = data.lat; p.lng = data.lng;
        p.name = data.name; p.heading = data.heading;
        p.trace.push([data.lat, data.lng]);
        if (p.trace.length > 80) p.trace.shift();
        io.emit('squad_update', squadPlayers);
    });

    socket.on('disconnect', () => {
        utilisateursConnectes--;
        logInfo(`Agent déconnecté [${ip}].`);
        delete squadPlayers[socket.id];
        io.emit('squad_update', squadPlayers);
    });
});

// ─────────────────────────────────────────────
//  ROUTES API
// ─────────────────────────────────────────────
app.get('/api/config', (_req, res) => res.json(lireConfig()));

app.get('/api/markers', (_req, res) => res.json(lireDonnees()));

app.post('/api/markers', (req, res) => {
    const ip = getClientIp(req);
    const points = lireDonnees();
    const nouveauPoint = { id: Date.now().toString(), ...req.body };
    points.push(nouveauPoint);
    sauvegarderDonnees(points);
    logAjout(`Spot "${nouveauPoint.nom}" créé par [${ip}].`);
    io.emit('marker_added', nouveauPoint);
    res.json(nouveauPoint);
});

app.put('/api/markers/:id', (req, res) => {
    const ip = getClientIp(req);
    const points = lireDonnees();
    const index = points.findIndex(p => p.id === req.params.id);
    if (index !== -1) {
        points[index] = { ...points[index], ...req.body };
        sauvegarderDonnees(points);
        logModif(`Spot "${points[index].nom}" MAJ par [${ip}].`);
        io.emit('marker_edited', points[index]);
        res.json(points[index]);
    } else {
        res.status(404).send('Non trouvé');
    }
});

app.delete('/api/markers/:id', (req, res) => {
    const ip = getClientIp(req);
    let points = lireDonnees();
    const p = points.find(x => x.id === req.params.id);
    if (p) {
        points = points.filter(x => x.id !== req.params.id);
        sauvegarderDonnees(points);
        logSuppr(`Spot "${p.nom}" SUPPRIMÉ par [${ip}].`);
        io.emit('marker_deleted', req.params.id);
    }
    res.json({ success: true });
});

// ─────────────────────────────────────────────
//  LANCEMENT DU SERVEUR
// ─────────────────────────────────────────────

// Redirection HTTP → HTTPS (prod uniquement)
if (IS_PROD && config.portHttp) {
    http.createServer((req, res) => {
        res.writeHead(301, { Location: `${config.domain}${req.url}` });
        res.end();
    }).listen(config.portHttp, () => {
        console.log(`\x1b[43m\x1b[30m 🔄 Redirection HTTP -> HTTPS activée sur le port ${config.portHttp} \x1b[0m`);
    });
}

// Serveur principal
server.listen(config.port, () => {
    const url = `${config.domain}:${config.port}`;
    if (IS_PROD) {
        console.log(`\x1b[42m\x1b[30m 🌍 Serveur Command Center lancé sur ${config.domain} \x1b[0m\n`);
    } else {
        console.log(`\x1b[44m\x1b[37m 🛠️  Serveur DEV lancé sur ${url} \x1b[0m\n`);
    }
});