const carteClassique = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20 });
const carteSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
const carteSombre = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 });
const carteTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 });

const map = L.map('map', { zoomControl: false, layers: [carteClassique] }).setView([48.0817, 7.3556], 13);

// --- LE FIX ANTI-ZONE GRISE ---
setTimeout(function() {
    map.invalidateSize();
}, 500);

// Recalcule aussi si tu tournes le téléphone (portrait/paysage)
window.addEventListener('resize', function() {
    map.invalidateSize();
});
// ------------------------------

let currentStyle = 'classique'; 
let userGPSMarker = null;
let currentTool = null; let tempLatLng = null; let markerEnCoursEdition = null; 
let pointMesure1 = null; let ligneMesure = null; 
const marqueursSurCarte = {};
const socket = io();

// --- GESTION DES MENUS DE L'INTERFACE V2 ---
function hideAllPanels() {
    document.getElementById('layers-menu').classList.add('hidden');
    document.getElementById('radio-panel').classList.add('hidden');
}

function toggleLayersMenu() {
    const menu = document.getElementById('layers-menu');
    const isHidden = menu.classList.contains('hidden');
    hideAllPanels();
    if (isHidden) menu.classList.remove('hidden');
}

function toggleRadio() {
    const panel = document.getElementById('radio-panel');
    const isHidden = panel.classList.contains('hidden');
    hideAllPanels();
    if (isHidden) panel.classList.remove('hidden');
}

function toggleRadar() {
    const radar = document.getElementById('radar-content');
    radar.classList.toggle('hidden');
}

// Clic sur la map = on ferme les menus volants
map.on('click', function() {
    hideAllPanels();
    document.getElementById('radar-content').classList.add('hidden');
});

// --- CONTROLES TERRAIN ---
function setMapStyle(styleRequested) {
    map.removeLayer(carteClassique); map.removeLayer(carteSatellite); map.removeLayer(carteSombre); map.removeLayer(carteTopo);
    document.body.classList.remove('dark-mode');
    
    if (styleRequested === 'satellite') { map.addLayer(carteSatellite); afficherNotification("🛰️ Mode Satellite", "#27ae60"); } 
    else if (styleRequested === 'topo') { map.addLayer(carteTopo); afficherNotification("⛰️ Topographie", "#8e44ad"); } 
    else if (styleRequested === 'nuit') { map.addLayer(carteSombre); document.body.classList.add('dark-mode'); afficherNotification("🦇 Vision Nocturne", "#c0392b"); } 
    else { map.addLayer(carteClassique); afficherNotification("🗺️ Carte Classique", "#3498db"); }
    
    currentStyle = styleRequested;
    hideAllPanels(); // On ferme le menu après sélection
}

function toggleStealth() {
    document.getElementById('stealth-screen').style.display = 'block';
    afficherNotification("🥷 Mode Furtif : Double-clique pour quitter.", "#111");
}
document.getElementById('stealth-screen').addEventListener('dblclick', () => {
    document.getElementById('stealth-screen').style.display = 'none';
});

function localiserMoi() {
    hideAllPanels();
    afficherNotification("Recherche GPS...", "#3498db"); 
    map.locate({setView: true, maxZoom: 17, enableHighAccuracy: true});
}

map.on('locationerror', function(e) { alert("❌ Erreur GPS : " + e.message); });
map.on('locationfound', function(e) {
    if (!userGPSMarker) {
        const radarIcon = L.divIcon({ className: 'gps-pulse-wrapper', html: `<div class="gps-pulse-container"><div class="gps-pulse-ring"></div><div class="gps-pulse-dot"></div></div>`, iconSize: [40, 40], iconAnchor: [20, 20] });
        userGPSMarker = L.marker(e.latlng, {icon: radarIcon, zIndexOffset: 1000}).addTo(map);
        userGPSMarker.bindPopup("<b>🎯 Tu es ici</b>").openPopup();
    } else { userGPSMarker.setLatLng(e.latlng); }
});

// --- RADIO ---
function sendRadio() {
    const input = document.getElementById('radio-input');
    const txt = input.value.trim();
    if(txt) { socket.emit('chat_message', txt); input.value = ''; }
}
socket.on('chat_message', (msg) => {
    const time = new Date().toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'});
    const box = document.getElementById('radio-messages');
    box.innerHTML += `<div class="msg-line"><span class="msg-time">[${time}]</span> ${msg}</div>`;
    box.scrollTop = box.scrollHeight;
    if (document.getElementById('radio-panel').classList.contains('hidden')) { afficherNotification("💬 Nouveau message Radio", "#3498db"); }
});

// --- SOS ---
function triggerSOS() {
    hideAllPanels();
    if(confirm("🚨 DÉCLENCHER LE S.O.S ? (Position envoyée à l'équipe)")) {
        if (!navigator.geolocation) { alert("❌ GPS non supporté."); return; }
        navigator.geolocation.getCurrentPosition(pos => {
            socket.emit('sos_alert', { lat: pos.coords.latitude, lng: pos.coords.longitude });
            afficherNotification("Signal de détresse envoyé !", "#c0392b");
        }, err => { alert("❌ Erreur GPS : " + err.message); }, { enableHighAccuracy: true, timeout: 10000 });
    }
}
socket.on('sos_alert', (data) => {
    document.getElementById('sos-screen').style.display = 'block';
    afficherNotification(`🚨 URGENCE ! MEMBRE EN DANGER !`, '#c0392b');
    const sosIcon = L.divIcon({ className: 'custom-pin-wrapper', html: `<div class="urbex-pin-container"><div class="urbex-pin bg-dangereux" style="width:40px; height:40px; border-color:yellow;"></div></div>`, iconSize: [50, 70], iconAnchor: [25, 70], popupAnchor: [0, -60] });
    L.marker([data.lat, data.lng], {icon: sosIcon, zIndexOffset: 9999}).addTo(map).bindPopup("<b style='color:red; font-size:16px;'>🚨 POSITION S.O.S !</b>").openPopup();
    map.setView([data.lat, data.lng], 18);
    setTimeout(() => { document.getElementById('sos-screen').style.display = 'none'; }, 10000);
});

// --- OUTILS ET NOTIFS ---
function afficherNotification(message, couleur) {
    const toast = document.createElement('div'); toast.innerText = message;
    toast.style.cssText = `position: fixed; top: 70px; left: 50%; transform: translateX(-50%) translateY(-50px); background: ${couleur}; color: white; padding: 10px 20px; border-radius: 30px; font-weight: bold; box-shadow: 0 4px 15px rgba(0,0,0,0.4); z-index: 4000; transition: all 0.3s ease; opacity: 0; text-align: center; font-size: 13px;`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; toast.style.opacity = '1'; }, 10);
    setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(-50px)'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

document.querySelectorAll('.filter-cb').forEach(cb => {
    cb.addEventListener('change', () => {
        Object.values(marqueursSurCarte).forEach(markerObj => {
            const statut = markerObj.marker.donnees.statut || 'accessible';
            const estCoche = document.querySelector(`.filter-cb[value="${statut}"]`).checked;
            if (estCoche) { if (!map.hasLayer(markerObj.marker)) map.addLayer(markerObj.marker); if (markerObj.cercle && !map.hasLayer(markerObj.cercle)) map.addLayer(markerObj.cercle); } 
            else { if (map.hasLayer(markerObj.marker)) map.removeLayer(markerObj.marker); if (markerObj.cercle && map.hasLayer(markerObj.cercle)) map.removeLayer(markerObj.cercle); }
        });
    });
});

socket.on('marker_added', (nouveauPoint) => { creerMarqueurSurCarte(nouveauPoint); afficherNotification(`📍 ${nouveauPoint.nom} ajouté`, '#1abc9c'); });
socket.on('marker_edited', (pointModifie) => {
    const markerObj = marqueursSurCarte[pointModifie.id];
    if (markerObj) { map.removeLayer(markerObj.marker); if (markerObj.cercle) map.removeLayer(markerObj.cercle); delete marqueursSurCarte[pointModifie.id]; creerMarqueurSurCarte(pointModifie); }
});
socket.on('marker_deleted', (idSupprime) => {
    const markerObj = marqueursSurCarte[idSupprime];
    if (markerObj) { map.removeLayer(markerObj.marker); if (markerObj.cercle) map.removeLayer(markerObj.cercle); delete marqueursSurCarte[idSupprime]; }
});

async function chargerMarkers() { const response = await fetch('/api/markers'); const points = await response.json(); points.forEach(point => creerMarqueurSurCarte(point)); }
chargerMarkers();

const statusText = document.getElementById('status-text');

function toggleTool(tool) {
    hideAllPanels();
    currentTool = (currentTool === tool) ? null : tool;
    document.getElementById('btn-add').classList.toggle('active-add', currentTool === 'add');
    document.getElementById('btn-edit').classList.toggle('active-edit', currentTool === 'edit');
    document.getElementById('btn-del').classList.toggle('active-del', currentTool === 'delete');
    document.getElementById('btn-measure').classList.toggle('active-measure', currentTool === 'measure');
    
    if (currentTool !== 'measure') { pointMesure1 = null; if (ligneMesure) map.removeLayer(ligneMesure); }
    
    if(currentTool === 'add') statusText.innerText = "📍 Ajout : Clique sur la carte"; 
    else if(currentTool === 'edit') statusText.innerText = "✏️ Modif : Clique sur un spot";
    else if(currentTool === 'delete') statusText.innerText = "🗑️ Suppr : Clique sur un spot"; 
    else if(currentTool === 'measure') statusText.innerText = "📏 Mesure : Clique au départ";
    else statusText.innerText = "👋 Prêt à explorer";
}

function creerIcone(statut) {
    let bgClass = 'bg-accessible'; if (statut === 'garde') bgClass = 'bg-garde'; if (statut === 'dangereux') bgClass = 'bg-dangereux'; if (statut === 'detruit') bgClass = 'bg-detruit';
    return L.divIcon({ className: 'custom-pin-wrapper', html: `<div class="urbex-pin-container"><div class="urbex-pin ${bgClass}"></div></div>`, iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -40] });
}

function genererPopupHTML(data) {
    const peopleHtml = data.personnes && data.personnes.length > 0 ? `<div style="font-size:12px; opacity:0.8;">${data.personnes.join(', ')}</div>` : `<div style="font-size:12px; opacity:0.8;">Solo</div>`;
    let badgeText = "Accessible"; let badgeClass = "badge-accessible";
    if (data.statut === 'garde') { badgeText = "Gardé / Caméras"; badgeClass = "badge-garde"; } if (data.statut === 'dangereux') { badgeText = "Dangereux / Ruine"; badgeClass = "badge-dangereux"; } if (data.statut === 'detruit') { badgeText = "Détruit / Muré"; badgeClass = "badge-detruit"; }
    
    return `
        <div style="min-width: 180px;">
            <div class="badge ${badgeClass}" style="display:inline-block; padding:3px 8px; border-radius:10px; font-size:10px; margin-bottom:5px; color:white;">${badgeText}</div>
            <h3 style="margin: 0 0 5px 0; font-size:15px; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:5px;">${data.nom}</h3>
            <div style="font-size: 12px;">📅 ${data.date || 'Inconnue'}</div>
            <div style="margin-top:5px; font-size: 12px;">👥 <strong>Équipe :</strong></div>${peopleHtml}
            <div class="dynamic-distance" style="margin-top: 8px; font-size: 12px; color: #3498db; font-weight:bold;">📍 Calcul...</div>
        </div>`;
}

function creerMarqueurSurCarte(dataMarqueur) {
    if (marqueursSurCarte[dataMarqueur.id]) return;
    const marker = L.marker([dataMarqueur.lat, dataMarqueur.lng], { icon: creerIcone(dataMarqueur.statut || 'accessible') }).addTo(map);
    marker.donnees = dataMarqueur; marker.bindPopup(genererPopupHTML(dataMarqueur), { className: 'custom-popup', closeButton: false });

    marker.on('popupopen', function() {
        if (userGPSMarker) {
            const distanceMetres = map.distance(userGPSMarker.getLatLng(), marker.getLatLng());
            let textDist = distanceMetres > 1000 ? (distanceMetres/1000).toFixed(2) + " km" : distanceMetres.toFixed(0) + " m";
            const distDiv = marker.getPopup().getElement().querySelector('.dynamic-distance');
            if (distDiv) distDiv.innerHTML = `🚶 ${textDist} de toi`;
        }
    });

    let dangerCircle = null;
    if (dataMarqueur.statut === 'garde' || dataMarqueur.statut === 'dangereux') {
        const estGarde = dataMarqueur.statut === 'garde';
        dangerCircle = L.circle([dataMarqueur.lat, dataMarqueur.lng], { color: estGarde ? '#f39c12' : '#e74c3c', fillColor: estGarde ? '#f39c12' : '#e74c3c', fillOpacity: 0.15, radius: estGarde ? 150 : 100 }).addTo(map);
        dangerCircle.bringToBack();
    }
    marqueursSurCarte[dataMarqueur.id] = { marker: marker, cercle: dangerCircle };

    marker.on('click', async function() {
        if (currentTool === 'delete') { marker.closePopup(); if (confirm(`Supprimer "${marker.donnees.nom}" ?`)) fetch(`/api/markers/${marker.donnees.id}`, { method: 'DELETE' }); } 
        else if (currentTool === 'edit') {
            marker.closePopup(); markerEnCoursEdition = marker;
            document.getElementById('modal-title').innerText = "Modifier le Spot"; document.getElementById('point-name').value = marker.donnees.nom; document.getElementById('point-date').value = marker.donnees.date === "Inconnue" ? "" : marker.donnees.date; document.getElementById('point-status').value = marker.donnees.statut || 'accessible';
            const pList = document.getElementById('people-list'); pList.innerHTML = '';
            if (!marker.donnees.personnes || marker.donnees.personnes.length === 0) { pList.innerHTML = '<input type="text" class="person-input" placeholder="Personne 1">'; } 
            else { marker.donnees.personnes.forEach((p, index) => { const input = document.createElement('input'); input.type = 'text'; input.className = 'person-input'; input.placeholder = `Personne ${index + 1}`; input.value = p; pList.appendChild(input); }); }
            document.getElementById('modal').style.display = 'flex';
        }
    });
}

map.on('click', function(e) {
    if (currentTool === 'add') { tempLatLng = e.latlng; document.getElementById('modal-title').innerText = "Nouveau Spot"; document.getElementById('modal').style.display = 'flex'; } 
    else if (currentTool === 'measure') {
        if (!pointMesure1) { pointMesure1 = e.latlng; statusText.innerText = "📏 Clique maintenant sur l'arrivée."; afficherNotification("Point de départ validé.", "#3498db"); } 
        else {
            const pointMesure2 = e.latlng; const distanceMetres = map.distance(pointMesure1, pointMesure2).toFixed(0);
            if (ligneMesure) map.removeLayer(ligneMesure);
            ligneMesure = L.polyline([pointMesure1, pointMesure2], { color: '#e74c3c', dashArray: '8, 8', weight: 3 }).addTo(map);
            ligneMesure.bindPopup(`<div style="text-align:center;"><strong style="color:#e74c3c; font-size:16px;">${distanceMetres} m</strong></div>`, {className: 'custom-popup', closeOnClick: false}).openPopup();
            pointMesure1 = null; statusText.innerText = "📏 Nouveau départ ?";
        }
    }
});

document.getElementById('btn-add-person').addEventListener('click', () => {
    const list = document.getElementById('people-list');
    if (list.children.length < 15) { const input = document.createElement('input'); input.type = 'text'; input.className = 'person-input'; input.placeholder = `Personne ${list.children.length + 1}`; list.appendChild(input); }
});

document.getElementById('btn-cancel').addEventListener('click', () => {
    document.getElementById('modal').style.display = 'none'; document.getElementById('point-name').value = ''; document.getElementById('point-date').value = ''; document.getElementById('point-status').value = 'accessible'; document.getElementById('people-list').innerHTML = '<input type="text" class="person-input" placeholder="Personne 1">'; tempLatLng = null; markerEnCoursEdition = null;
});

document.getElementById('btn-confirm').addEventListener('click', () => {
    const name = document.getElementById('point-name').value.trim() || "Spot"; const date = document.getElementById('point-date').value || "Inconnue"; const statut = document.getElementById('point-status').value;
    let peopleNames = []; document.querySelectorAll('.person-input').forEach(input => { if (input.value.trim() !== '') peopleNames.push(input.value.trim()); });
    if (markerEnCoursEdition) { const updatedData = { nom: name, date: date, statut: statut, personnes: peopleNames }; fetch(`/api/markers/${markerEnCoursEdition.donnees.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) }); } 
    else { const newData = { lat: tempLatLng.lat, lng: tempLatLng.lng, nom: name, date: date, statut: statut, personnes: peopleNames }; fetch('/api/markers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newData) }); }
    document.getElementById('btn-cancel').click();
});