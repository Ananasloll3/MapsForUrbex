const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// --- FORMATAGE DE LA CONSOLE (Design Hacker/Admin) ---
const obtenirHeure = () => new Date().toLocaleTimeString('fr-FR');
const logInfo = (msg) => console.log(`\x1b[36m[${obtenirHeure()}] 🔵 INFO :\x1b[0m ${msg}`);
const logAjout = (msg) => console.log(`\x1b[32m[${obtenirHeure()}] 🟢 AJOUT :\x1b[0m ${msg}`);
const logModif = (msg) => console.log(`\x1b[33m[${obtenirHeure()}] 🟠 MODIF :\x1b[0m ${msg}`);
const logSuppr = (msg) => console.log(`\x1b[31m[${obtenirHeure()}] 🔴 ALERTE :\x1b[0m ${msg}`);

// --- 🕵️ FONCTION POUR RÉCUPÉRER LA VRAIE IP (Même derrière Ngrok/Localtunnel) ---
function getClientIp(reqOrSocket) {
    let ip = "IP Inconnue";
    // Si c'est une requête Express
    if (reqOrSocket.headers && reqOrSocket.headers['x-forwarded-for']) {
        ip = reqOrSocket.headers['x-forwarded-for'].split(',')[0];
    } 
    // Si c'est une connexion Socket.io
    else if (reqOrSocket.handshake && reqOrSocket.handshake.headers['x-forwarded-for']) {
        ip = reqOrSocket.handshake.headers['x-forwarded-for'].split(',')[0];
    } 
    // Cas normaux (réseau local)
    else if (reqOrSocket.connection && reqOrSocket.connection.remoteAddress) {
        ip = reqOrSocket.connection.remoteAddress;
    } else if (reqOrSocket.handshake && reqOrSocket.handshake.address) {
        ip = reqOrSocket.handshake.address;
    } else if (reqOrSocket.ip) {
        ip = reqOrSocket.ip;
    }
    // Nettoyer le format IPv6 local (::ffff:192.168...) pour plus de lisibilité
    if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1];
    return ip;
}

function lireDonnees() {
    if (!fs.existsSync(DATA_FILE)) { fs.writeFileSync(DATA_FILE, JSON.stringify([])); }
    return JSON.parse(fs.readFileSync(DATA_FILE));
}
function sauvegarderDonnees(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let utilisateursConnectes = 0;
let squadPlayers = {}; 

// ==========================================
// 📡 GESTION DU MULTIJOUEUR ET DES LOGS
// ==========================================
io.on('connection', (socket) => {
    const ip = getClientIp(socket);
    utilisateursConnectes++;
    logInfo(`Agent connecté depuis l'IP [${ip}]. (En ligne : ${utilisateursConnectes})`);

    socket.on('chat_message', (msg) => { 
        logInfo(`💬 [${ip}] Message Radio : ${msg}`);
        io.emit('chat_message', msg); 
    });

    socket.on('sos_alert', (data) => {
        logSuppr(`🚨 S.O.S DÉCLENCHÉ PAR [${ip}] AUX COORDONNÉES : ${data.lat}, ${data.lng}`);
        io.emit('sos_alert', data);
    });

    socket.on('ping_tactique', (data) => {
        logInfo(`📍 Ping tactique reçu de l'IP [${ip}] : Lat ${data.lat}, Lng ${data.lng}`);
        io.emit('ping_tactique', data); 
    });

    socket.on('player_move', (data) => {
        if (!squadPlayers[socket.id]) {
            squadPlayers[socket.id] = { trace: [], ip: ip };
        }
        squadPlayers[socket.id].lat = data.lat;
        squadPlayers[socket.id].lng = data.lng;
        squadPlayers[socket.id].name = data.name;
        squadPlayers[socket.id].heading = data.heading;
        
        squadPlayers[socket.id].trace.push([data.lat, data.lng]);
        if (squadPlayers[socket.id].trace.length > 80) {
            squadPlayers[socket.id].trace.shift(); 
        }
        
        io.emit('squad_update', squadPlayers);
    });

    socket.on('disconnect', () => {
        utilisateursConnectes--;
        logInfo(`Agent déconnecté [${ip}]. (En ligne : ${utilisateursConnectes})`);
        delete squadPlayers[socket.id];
        io.emit('squad_update', squadPlayers);
    });
});

// ==========================================
// 🗺️ GESTION DE LA CARTE ET DES MARQUEURS
// ==========================================
app.get('/api/markers', (req, res) => { res.json(lireDonnees()); });

app.post('/api/markers', (req, res) => {
    const ip = getClientIp(req);
    const points = lireDonnees(); 
    const nouveauPoint = { id: Date.now().toString(), ...req.body };
    points.push(nouveauPoint); 
    sauvegarderDonnees(points);
    logAjout(`Spot "${nouveauPoint.nom}" créé par l'IP [${ip}].`);
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
        logModif(`Spot "${points[index].nom}" mis à jour par [${ip}].`);
        io.emit('marker_edited', points[index]); 
        res.json(points[index]);
    } else { 
        res.status(404).send('Non trouvé'); 
    }
});

app.delete('/api/markers/:id', (req, res) => {
    const ip = getClientIp(req);
    let points = lireDonnees(); 
    const p = points.find(p => p.id === req.params.id);
    if (p) {
        points = points.filter(x => x.id !== req.params.id); 
        sauvegarderDonnees(points);
        logSuppr(`Spot "${p.nom}" SUPPRIMÉ par l'IP [${ip}].`); 
        io.emit('marker_deleted', req.params.id);
    }
    res.json({ success: true });
});

server.listen(PORT, () => { console.log(`\x1b[45m\x1b[30m 🌍 Serveur Command Center lancé sur http://localhost:${PORT} \x1b[0m\n`); });