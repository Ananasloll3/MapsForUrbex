const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const readline = require('readline');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// ─────────────────────────────────────────────
//  CHARGEMENT DU FICHIER .env UNIQUE
// ─────────────────────────────────────────────
require('dotenv').config({ override: true }); 

const ENV = (process.env.NODE_ENV || 'development').trim();
const IS_PROD   = ENV === 'production';
const ENV_LABEL = IS_PROD ? '🟢 PROD' : '🟡 DEV';

console.log(`\x1b[1m[CONFIG] Démarrage en mode : ${ENV_LABEL}\x1b[0m`);

const config = {
    portHttp:  process.env.PORT_HTTP  || 3000,
    portHttps: process.env.PORT_HTTPS || 443,
    useHttps:  process.env.USE_HTTPS === 'true',
    domain:    process.env.DOMAIN     || 'http://localhost',
    sslKey:    process.env.SSL_KEY    || null,
    sslCert:   process.env.SSL_CERT   || null,
};

const DATA_FILE   = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PASSWORDS_FILE = path.join(__dirname, 'passwords.json');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser()); // 🟢 AJOUT : Activation du lecteur de cookies

const obtenirHeure = () => new Date().toLocaleTimeString('fr-FR');
const logInfo   = (msg) => console.log(`\x1b[36m[${obtenirHeure()}] 🔵 INFO :\x1b[0m ${msg}`);
const logAjout  = (msg) => console.log(`\x1b[32m[${obtenirHeure()}] 🟢 AJOUT :\x1b[0m ${msg}`);
const logSucces = (msg) => console.log(`\x1b[32m[${obtenirHeure()}] 🟢 SUCCES :\x1b[0m ${msg}`);
const logModif  = (msg) => console.log(`\x1b[33m[${obtenirHeure()}] 🟠 MODIF :\x1b[0m ${msg}`);
const logSuppr  = (msg) => console.log(`\x1b[31m[${obtenirHeure()}] 🔴 ALERTE :\x1b[0m ${msg}`);
const logErreur = (msg) => console.log(`\x1b[31m[${obtenirHeure()}] 🔴 Erreur :\x1b[0m ${msg}`);


// ─────────────────────────────────────────────
//  🟢 AJOUT : SYSTÈME DE LOGIN & SÉCURITÉ
// ─────────────────────────────────────────────

// Route qui vérifie le mot de passe tapé par l'utilisateur
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    
    if (!password) {
        return res.status(400).json({ success: false, message: "Mot de passe vide" });
    }

    // On transforme ce que l'utilisateur a tapé en SHA-256
    const hashedInput = crypto.createHash('sha256').update(password).digest('hex').toLowerCase();

    let validHashes = [];
    
    try {
        if (fs.existsSync(PASSWORDS_FILE)) {
            validHashes = JSON.parse(fs.readFileSync(PASSWORDS_FILE));
        }
    } catch (e) {
        console.error("Erreur de lecture du fichier passwords.json", e);
    }
    

    // On regarde si le hash de l'utilisateur est dans notre liste
    if (validHashes.includes(hashedInput)) {
        // Le mot de passe est bon !
        res.cookie('urbex_auth', 'access_granted', {
            maxAge: 1 * 24 * 60 * 60 * 1000, 
            httpOnly: true,
            sameSite: 'Strict'
        });
        logSucces(`Accès autorisé avec un mot de passe valide.`);
        return res.json({ success: true });
    } else {
        // Mauvais mot de passe
        logErreur(`Tentative d'accès refusée pour l'ip : ${getClientIp(req)}`);
        return res.status(401).json({ success: false, message: "Code erroné" });
    }
});

// Le "Pare-feu" : bloque tous ceux qui n'ont pas le cookie
app.use((req, res, next) => {
    // On autorise explicitement la page de login et la route API pour pouvoir se connecter
    if (req.path === '/login.html' || req.path === '/login.js' || req.path === '/api/login' || req.path.endsWith('.css')) {
        return next();
    }

    // On vérifie si l'utilisateur possède le fameux cookie d'accès
    if (req.cookies && req.cookies.urbex_auth === 'access_granted') {
        return next(); // C'est bon, on le laisse passer vers ton app
    }

    // S'il n'a pas le cookie, on le redirige de force vers la page de login
    if (req.accepts('html')) {
        return res.redirect('/login.html');
    }
    
    // S'il essaye de tricher en appelant directement l'API des marqueurs
    res.status(401).json({ error: 'Accès refusé' });
});

// ─────────────────────────────────────────────
// (Fin des ajouts de sécurité)
// ─────────────────────────────────────────────

app.use(express.static('public'));

let server;

if (config.useHttps) {
    if (!config.sslKey || !config.sslCert) {
        logErreur("USE_HTTPS est activé mais les chemins SSL_KEY ou SSL_CERT sont manquants dans le .env");
        process.exit(1);
    }
    const sslOptions = {
        key:  fs.readFileSync(config.sslKey),
        cert: fs.readFileSync(config.sslCert),
    };
    server = https.createServer(sslOptions, app);
} else {
    server = http.createServer(app);
}

const io = new Server(server);

function getClientIp(reqOrSocket) {
    let ip = 'IP Inconnue';
    if (reqOrSocket.headers?.['x-forwarded-for'])                   ip = reqOrSocket.headers['x-forwarded-for'].split(',')[0];
    else if (reqOrSocket.handshake?.headers['x-forwarded-for'])     ip = reqOrSocket.handshake.headers['x-forwarded-for'].split(',')[0];
    else if (reqOrSocket.connection?.remoteAddress)                 ip = reqOrSocket.connection.remoteAddress;
    else if (reqOrSocket.handshake?.address)                        ip = reqOrSocket.handshake.address;
    else if (reqOrSocket.ip)                                        ip = reqOrSocket.ip;
    if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];
    return ip;
}

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

// 🟢 AJOUT : On sécurise aussi les connexions en temps réel (Sockets)
io.use((socket, next) => {
    const cookieHeader = socket.request.headers.cookie;
    if (cookieHeader && cookieHeader.includes('urbex_auth=access_granted')) {
        next();
    } else {
        next(new Error("Accès radio refusé."));
    }
});

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
//  COMMANDES DEV CONSOLE
// ─────────────────────────────────────────────
const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', (input) => {
    const text = input.trim();
    
    if (text.startsWith('/title ')) {
        const message = text.replace('/title ', '');
        console.log(`\x1b[35m[GOD MODE]\x1b[0m Titre géant envoyé : "${message}"`);
        io.emit('dev_title', message);
    } 
    else if (text.startsWith('/alert ')) {
        const message = text.replace('/alert ', '');
        console.log(`\x1b[31m[ALERTE]\x1b[0m Notification envoyée : "${message}"`);
        io.emit('dev_alert', message);
    }
    else if (text === '/panic') {
        console.log(`\x1b[41m\x1b[37m[PANIC MODE]\x1b[0m Faux écran RandoCartes forcé chez tout le monde !`);
        io.emit('force_panic');
    }
    else if (text === '/refresh') {
        console.log(`\x1b[36m[UPDATE]\x1b[0m Rafraîchissement forcé des pages clients...`);
        io.emit('force_refresh');
    }
    else if (text === '/users') {
        const count = io.engine ? io.engine.clientsCount : 0;
        console.log(`\x1b[32m[INFO]\x1b[0m Utilisateurs actuellement connectés : ${count}`);
    }
    else if (text.startsWith('/addpass ')) {
        const rawPassword = text.replace('/addpass ', '').trim();
        
        if (!rawPassword) {
            console.log(`\x1b[31m[ERREUR]\x1b[0m Tu dois préciser un mot de passe. Usage : /addpass <password>`);
            return;
        }

        // On hash le nouveau mot de passe exactement comme dans le login
        const hashedInput = crypto.createHash('sha256').update(rawPassword).digest('hex').toLowerCase();

        let validHashes = [];
        
        // On récupère les mots de passe existants
        try {
            if (fs.existsSync(PASSWORDS_FILE)) {
                const fileContent = fs.readFileSync(PASSWORDS_FILE, 'utf-8');
                if (fileContent.trim() !== '') {
                    validHashes = JSON.parse(fileContent);
                }
            }
        } catch (e) {
            console.error(`\x1b[31m[ERREUR]\x1b[0m Impossible de lire passwords.json`, e);
        }

        // On vérifie s'il n'existe pas déjà pour éviter les doublons
        if (!validHashes.includes(hashedInput)) {
            validHashes.push(hashedInput);
            try {
                // On sauvegarde le tableau mis à jour
                fs.writeFileSync(PASSWORDS_FILE, JSON.stringify(validHashes, null, 2));
                console.log(`\x1b[32m[SUCCÈS]\x1b[0m Le mot de passe a été hashé et ajouté à passwords.json !`);
            } catch (e) {
                console.error(`\x1b[31m[ERREUR]\x1b[0m Impossible d'écrire dans passwords.json`, e);
            }
        } else {
            console.log(`\x1b[33m[INFO]\x1b[0m Ce mot de passe est déjà autorisé dans la base.`);
        }
    }
    else if (text.startsWith('/')) {
        console.log(`Commande inconnue : ${text}. Tapez /help pour la liste.`);
    }
});

// ─────────────────────────────────────────────
//  LANCEMENT DU SERVEUR
// ─────────────────────────────────────────────
if (config.useHttps && config.portHttp) {
    http.createServer((req, res) => {
        const host = config.domain.startsWith('http') ? config.domain.replace('http://', 'https://') : `https://${config.domain}`;
        res.writeHead(301, { Location: `${host}${req.url}` });
        res.end();
    }).listen(config.portHttp, () => {
        console.log(`\x1b[43m\x1b[30m 🔄 Redirection HTTP -> HTTPS activée sur le port ${config.portHttp} \x1b[0m`);
    });
}

const portPrincipal = config.useHttps ? config.portHttps : config.portHttp;

server.listen(portPrincipal, () => {
    if (config.useHttps) {
        console.log(`\x1b[42m\x1b[30m 🌍 Serveur Command Center (HTTPS) lancé sur ${config.domain} \x1b[0m\n`);
    } else {
        console.log(`\x1b[44m\x1b[37m 🛠️  Serveur DEV (HTTP) lancé sur ${config.domain}:${portPrincipal} \x1b[0m\n`);
    }
});