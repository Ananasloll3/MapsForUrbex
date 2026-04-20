document.querySelector('.login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); // Empêche la page de se recharger
    
    // Récupère ce qui a été tapé
    const password = document.querySelector('input[type="password"]').value;
    
    // Envoie au serveur
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    
    if (res.ok) {
        // Succès ! Le serveur a mis le cookie, on redirige vers la carte
        window.location.href = '/index.html'; 
    } else {
        // Échec, on avertit l'utilisateur
        alert('Accès refusé. Mauvaise clé.');
    }
});
