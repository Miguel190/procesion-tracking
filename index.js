const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const secret = process.env.SESSION_SECRET || 'secret_cat';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
const mongoUri = process.env.MONGODB_URI;

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

// --- MONGODB SETUP ---
let isMongo = false;
if (mongoUri && !mongoUri.includes("USUARIO:PASSWORD")) {
    mongoose.connect(mongoUri)
        .then(() => {
            console.log("✅ Conectado a MongoDB Atlas");
            isMongo = true;
            loadConfig(); // Recargar desde DB
            loadLocations(); // Recargar desde DB
        })
        .catch(err => console.error("❌ Error conectando a MongoDB:", err));
} else {
    console.log("⚠️ Usando archivos locales para persistencia (Sin MONGODB_URI)");
}

const ConfigSchema = new mongoose.Schema({
    deviceId: { type: String, unique: true },
    name: String,
    emoji: String
});
const LocationSchema = new mongoose.Schema({
    deviceId: { type: String, unique: true },
    name: String,
    emoji: String,
    lat: Number,
    lon: Number,
    timestamp: Number,
    speed: Number
});

const ConfigModel = mongoose.model('Config', ConfigSchema);
const LocationModel = mongoose.model('Location', LocationSchema);

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
async function loadConfig() {
    try {
        if (isMongo) {
            const data = await ConfigModel.find({});
            const config = {};
            data.forEach(d => config[d.deviceId] = { name: d.name, emoji: d.emoji });
            processionConfig = config;
            return config;
        } else if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            processionConfig = JSON.parse(data);
            return processionConfig;
        }
    } catch (err) {
        console.error("Error cargando config:", err);
    }
    processionConfig = {};
    return {};
}

// Función para cargar ubicaciones persistidas
async function loadLocations() {
    try {
        if (isMongo) {
            const data = await LocationModel.find({});
            const locations = {};
            data.forEach(d => locations[d.deviceId] = {
                id: d.deviceId, name: d.name, emoji: d.emoji, lat: d.lat, lon: d.lon, timestamp: d.timestamp, speed: d.speed
            });
            processions = locations;
            return locations;
        } else if (fs.existsSync(LOCATIONS_FILE)) {
            const data = fs.readFileSync(LOCATIONS_FILE, 'utf8');
            processions = JSON.parse(data);
            return processions;
        }
    } catch (err) {
        console.error("Error cargando ubicaciones:", err);
    }
    processions = {};
    return {};
}

// Función para guardar ubicaciones
async function saveLocations(locations) {
    try {
        if (!isMongo) {
            fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(locations, null, 4));
        } else {
            // MongoDB actualiza por documento, no es necesario hacer nada aquí 
            // ya que guardamos individualmente en /traccar para evitar loops
        }
    } catch (err) {
        console.error("Error guardando ubicaciones:", err);
    }
}

// Función para guardar configuración
async function saveConfig(config) {
    try {
        if (!isMongo) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
        }
        processionConfig = config;
    } catch (err) {
        console.error("Error guardando config:", err);
    }
}

let processionConfig = {};
let processions = {};
loadConfig();
loadLocations();

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

app.get('/admin/config', checkAuth, async (req, res) => {
    await loadConfig();
    res.json(processionConfig);
});

app.post('/admin/config', checkAuth, async (req, res) => {
    const { deviceId, name, emoji } = req.body;
    if (!deviceId || !name || !emoji) return res.status(400).send("Faltan datos");

    const config = await loadConfig();
    config[deviceId] = { name, emoji };

    if (isMongo) {
        await ConfigModel.findOneAndUpdate({ deviceId }, { name, emoji }, { upsert: true });
    }

    await saveConfig(config);
    res.send("OK");
});

app.delete('/admin/config/:id', checkAuth, async (req, res) => {
    const id = req.params.id;
    const config = await loadConfig();
    if (config[id]) {
        delete config[id];

        if (isMongo) {
            await ConfigModel.deleteOne({ deviceId: id });
            await LocationModel.deleteOne({ deviceId: id });
        }

        await saveConfig(config);

        // También eliminar de las ubicaciones actuales para que desaparezca del mapa
        if (processions[id]) {
            delete processions[id];
            await saveLocations(processions);
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

app.all('/traccar', async (req, res) => {
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

        const updateData = {
            id: id,
            name: config.name,
            emoji: config.emoji,
            lat: parseFloat(lat),
            lon: parseFloat(lon),
            timestamp: normalizedTs,
            speed: parseFloat(speed) || 0
        };

        processions[id] = updateData;

        if (isMongo) {
            await LocationModel.findOneAndUpdate({ deviceId: id }, {
                deviceId: id,
                name: config.name,
                emoji: config.emoji,
                lat: parseFloat(lat),
                lon: parseFloat(lon),
                timestamp: normalizedTs,
                speed: parseFloat(speed) || 0
            }, { upsert: true });
        }

        // Guardar en disco para que sobreviva a reinicios
        await saveLocations(processions);

        console.log(`✅ [OK] ${config.emoji} ${config.name} (${id}) actualizada: ${lat}, ${lon}`);
        res.status(200).send('OK');
    } else {
        res.status(400).send('Missing lat/lon or id');
    }
});

app.get('/all-processions', async (req, res) => {
    await loadLocations();
    res.json(Object.values(processions));
});

app.get('/latest-location', async (req, res) => {
    const id = req.query.id;
    await loadLocations();
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
    const dateStr = new Date(target.timestamp).toLocaleString('es-GT', {
        timeZone: 'America/Guatemala',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    res.json({
        status: 'success',
        ...target,
        google_maps: mapsUrl,
        text: `${target.emoji} Ubicación de: ${target.name}\n📍 Maps: ${mapsUrl}\n⌚ Última actualización:\n${dateStr}`
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
