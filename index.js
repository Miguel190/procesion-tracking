const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const secret = process.env.SESSION_SECRET || 'secret_cat';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

const CONFIG_FILE = path.join(__dirname, 'config.json');
const LOCATIONS_FILE = path.join(__dirname, 'last_locations.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de sesión
app.use(session({
    secret: secret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

app.use(express.static('public'));

// Middleware de autenticación
function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        next();
    } else {
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            res.status(401).json({ status: 'error', message: 'No autorizado' });
        } else {
            res.redirect('/login');
        }
    }
}

// Función para cargar configuración
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("Error cargando config:", err);
    }
    return {};
}

// Función para cargar ubicaciones persistidas
function loadLocations() {
    try {
        if (fs.existsSync(LOCATIONS_FILE)) {
            const data = fs.readFileSync(LOCATIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("Error cargando ubicaciones:", err);
    }
    return {};
}

// Función para guardar ubicaciones
function saveLocations(locations) {
    try {
        fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(locations, null, 4));
    } catch (err) {
        console.error("Error guardando ubicaciones:", err);
    }
}

// Función para guardar configuración
function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
        processionConfig = config; // Actualizar en memoria
    } catch (err) {
        console.error("Error guardando config:", err);
    }
}

let processionConfig = loadConfig();
let processions = loadLocations();

// --- RUTAS DE AUTENTICACIÓN ---

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === adminPassword) {
        req.session.loggedIn = true;
        res.json({ status: 'success' });
    } else {
        res.status(401).json({ status: 'error', message: 'Contraseña incorrecta' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- ENDPOINTS ADMINISTRACIÓN (PROTEGIDOS) ---

app.get('/admin/config', checkAuth, (req, res) => {
    res.json(processionConfig);
});

app.post('/admin/config', checkAuth, (req, res) => {
    const { deviceId, name, emoji } = req.body;
    if (!deviceId || !name || !emoji) return res.status(400).send("Faltan datos");

    const config = loadConfig();
    config[deviceId] = { name, emoji };
    saveConfig(config);
    res.send("OK");
});

app.delete('/admin/config/:id', checkAuth, (req, res) => {
    const id = req.params.id;
    const config = loadConfig();
    if (config[id]) {
        delete config[id];
        saveConfig(config);

        // También eliminar de las ubicaciones actuales para que desaparezca del mapa
        if (processions[id]) {
            delete processions[id];
            saveLocations(processions);
        }

        res.send("OK");
    } else {
        res.status(404).send("No encontrado");
    }
});

app.get('/admin', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- ENDPOINTS RASTREO ---

app.all('/traccar', (req, res) => {
    const data = { ...req.query, ...req.body };

    let lat = data.lat || data.latitude;
    let lon = data.lon || data.longitude || data.lng;
    let id = data.id || data.deviceid || data.userId || data.device_id;
    let timestamp = data.timestamp || data.time;
    let speed = data.speed || data.spd;

    if (data.location && data.location.coords) {
        lat = data.location.coords.latitude;
        lon = data.location.coords.longitude;
        timestamp = data.location.timestamp;
        speed = data.location.coords.speed;
    }

    if (lat && lon && id) {
        let normalizedTs = timestamp;
        if (!isNaN(timestamp)) {
            normalizedTs = parseFloat(timestamp) < 10000000000 ? parseFloat(timestamp) * 1000 : parseFloat(timestamp);
        } else if (!timestamp) {
            normalizedTs = Date.now();
        } else {
            normalizedTs = new Date(timestamp).getTime();
        }

        const config = processionConfig[id] || { name: `Dispositivo ${id}`, emoji: "📍" };

        processions[id] = {
            id: id,
            name: config.name,
            emoji: config.emoji,
            lat: parseFloat(lat),
            lon: parseFloat(lon),
            timestamp: normalizedTs,
            speed: parseFloat(speed) || 0
        };

        // Guardar en disco para que sobreviva a reinicios
        saveLocations(processions);

        console.log(`✅ [OK] ${config.emoji} ${config.name} (${id}) actualizada: ${lat}, ${lon}`);
        res.status(200).send('OK');
    } else {
        res.status(400).send('Missing lat/lon or id');
    }
});

app.get('/all-processions', (req, res) => {
    res.json(Object.values(processions));
});

app.get('/latest-location', (req, res) => {
    const id = req.query.id;
    let target = null;

    if (id && processions[id]) {
        target = processions[id];
    } else {
        const list = Object.values(processions);
        if (list.length > 0) {
            target = list.sort((a, b) => b.timestamp - a.timestamp)[0];
        }
    }

    if (!target) {
        return res.json({ status: 'error', message: 'No hay procesos activas actualmente.' });
    }

    const mapsUrl = `https://www.google.com/maps?q=${target.lat},${target.lon}`;
    res.json({
        status: 'success',
        ...target,
        google_maps: mapsUrl,
        text: `${target.emoji} Ubicación de: ${target.name}\n📍 Maps: ${mapsUrl}\n⌚ Última actualización: ${new Date(target.timestamp).toLocaleString()}`
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🚀 Sistema Multi-Procesiones corriendo en puerto ${PORT}`);
    console.log(`--------------------------------------------------------`);
    console.log(`Público: http://localhost:${PORT}`);
    console.log(`Admin:   http://localhost:${PORT}/admin`);
    console.log(`--------------------------------------------------------\n`);
});
