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

app.use(express.json());
app.use(express.static('public'));

const obtenirHeure = () => new Date().toLocaleTimeString('fr-FR');
const logInfo = (msg) => console.log(`\x1b[36m[${obtenirHeure()}] 🔵 INFO :\x1b[0m ${msg}`);
const logAjout = (msg) => console.log(`\x1b[32m[${obtenirHeure()}] 🟢 AJOUT :\x1b[0m ${msg}`);
const logModif = (msg) => console.log(`\x1b[33m[${obtenirHeure()}] 🟠 MODIF :\x1b[0m ${msg}`);
const logSuppr = (msg) => console.log(`\x1b[31m[${obtenirHeure()}] 🔴 ALERTE :\x1b[0m ${msg}`);

function lireDonnees() {
    if (!fs.existsSync(DATA_FILE)) { fs.writeFileSync(DATA_FILE, JSON.stringify([])); }
    return JSON.parse(fs.readFileSync(DATA_FILE));
}
function sauvegarderDonnees(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let utilisateursConnectes = 0;

io.on('connection', (socket) => {
    utilisateursConnectes++;
    logInfo(`Explorateur connecté. (En ligne : ${utilisateursConnectes})`);

    // --- NOUVEAU : GESTION RADIO ET SOS ---
    socket.on('chat_message', (msg) => {
        io.emit('chat_message', msg); // Renvoie le message à tout le monde
    });

    socket.on('sos_alert', (data) => {
        logSuppr(`🚨 S.O.S DÉCLENCHÉ AUX COORDONNÉES : ${data.lat}, ${data.lng}`);
        io.emit('sos_alert', data); // Alerte générale !
    });

    socket.on('disconnect', () => {
        utilisateursConnectes--;
        logInfo(`Explorateur déconnecté. (En ligne : ${utilisateursConnectes})`);
    });
});

app.get('/api/markers', (req, res) => { res.json(lireDonnees()); });
app.post('/api/markers', (req, res) => {
    const points = lireDonnees(); const nouveauPoint = { id: Date.now().toString(), ...req.body };
    points.push(nouveauPoint); sauvegarderDonnees(points);
    logAjout(`Spot "${nouveauPoint.nom}" créé.`);
    io.emit('marker_added', nouveauPoint); res.json(nouveauPoint);
});
app.put('/api/markers/:id', (req, res) => {
    const points = lireDonnees(); const index = points.findIndex(p => p.id === req.params.id);
    if (index !== -1) {
        points[index] = { ...points[index], ...req.body }; sauvegarderDonnees(points);
        logModif(`Spot mis à jour : "${points[index].nom}".`);
        io.emit('marker_edited', points[index]); res.json(points[index]);
    } else { res.status(404).send('Non trouvé'); }
});
app.delete('/api/markers/:id', (req, res) => {
    let points = lireDonnees(); const p = points.find(p => p.id === req.params.id);
    if (p) {
        points = points.filter(x => x.id !== req.params.id); sauvegarderDonnees(points);
        logSuppr(`Spot "${p.nom}" effacé.`); io.emit('marker_deleted', req.params.id);
    }
    res.json({ success: true });
});

server.listen(PORT, () => { console.log(`\x1b[45m\x1b[30m 🌍 Serveur MapsForUrbex lancé sur http://localhost:${PORT} \x1b[0m\n`); });