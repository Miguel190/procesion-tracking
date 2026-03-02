const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const { MongoStore } = require('connect-mongo');
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

let isMongo = false;
let processionConfig = {};
let processions = {};
const addressCache = {};

// --- MONGODB MODELS ---
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

// --- UTILITY FUNCTIONS ---

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

async function saveLocations(locations) {
    try {
        if (!isMongo) {
            fs.writeFileSync(LOCATIONS_FILE, JSON.stringify(locations, null, 4));
        }
    } catch (err) {
        console.error("Error guardando ubicaciones:", err);
    }
}

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

async function getAddress(lat, lon) {
    if (!lat || !lon) return "Coordenadas no disponibles";
    const key = `${parseFloat(lat).toFixed(5)},${parseFloat(lon).toFixed(5)}`;
    if (addressCache[key]) return addressCache[key];
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
            headers: { 'User-Agent': 'ProcesionTracking/1.0 (migue@example.com)' }
        });
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return "Dirección no disponible";
        }
        if (data && data.display_name) {
            const addr = data.address;
            const parts = [];
            if (addr.road) parts.push(addr.road);
            if (addr.neighbourhood || addr.suburb) parts.push(addr.neighbourhood || addr.suburb);
            if (addr.city || addr.town) parts.push(addr.city || addr.town);
            const result = parts.length > 0 ? parts.join(', ') : data.display_name;
            addressCache[key] = result;
            return result;
        }
    } catch (err) { }
    return "Dirección no disponible";
}

function checkAuth(req, res, next) {
    if (req.session && req.session.loggedIn) {
        next();
    } else {
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            res.status(401).json({ status: 'error', message: 'No autorizado' });
        } else {
            res.redirect('/login');
        }
    }
}

// --- APP INITIALIZATION ---

async function init() {
    console.log("🚀 Iniciando sistema...");

    // 1. Intentar conectar a MongoDB Atlas
    if (mongoUri && !mongoUri.includes("USUARIO:PASSWORD")) {
        try {
            // Log más preciso para detectar errores de formato (sin revelar la contraseña)
            let maskedUri = "URI malformada";
            if (mongoUri.includes('@')) {
                try {
                    const url = new URL(mongoUri);
                    maskedUri = `${url.protocol}//${url.username}:****@${url.host}${url.pathname}${url.search}`;
                } catch (e) {
                    // Fallback si URL falla
                    const parts = mongoUri.split('@');
                    maskedUri = `${parts[0].split(':')[0]}:****@${parts[1]}`;
                }
            }
            console.log(`📡 Intentando conectar a: ${maskedUri}`);

            if (!mongoUri.startsWith("mongodb+srv://")) {
                console.warn("⚠️ Advertencia: El MONGODB_URI debería empezar con 'mongodb+srv://' (con dos barras)");
            }

            // Check for brackets in password (common mistake)
            if (mongoUri.includes("<") || mongoUri.includes(">")) {
                console.warn("⚠️ Advertencia: Detectamos caracteres '<' o '>' en tu URI. Asegúrate de haber quitado los corchetes de la contraseña de Atlas.");
            }

            // Mongoose connection with timeout to avoid long hangs
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
            console.log("✅ Conectado a MongoDB Atlas");
            isMongo = true;
        } catch (err) {
            console.error("❌ Error conectando a MongoDB:", err.message);
            console.log("⚠️ Fallback: Usando archivos locales para persistencia");
            isMongo = false;
        }
    } else {
        console.log("⚠️ Sin MONGODB_URI válido, usando archivos locales");
    }

    // 2. Cargar datos iniciales
    await loadConfig();
    await loadLocations();

    // 3. Configuración de sesión (Dynamic Store)
    const sessionConfig = {
        secret: secret,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
    };

    if (isMongo) {
        sessionConfig.store = MongoStore.create({
            clientPromise: Promise.resolve(mongoose.connection.getClient()),
            ttl: 24 * 60 * 60
        });
    }

    app.use(session(sessionConfig));
    app.use(express.static('public'));

    // 4. RUTAS

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

    app.all('/traccar', async (req, res) => {
        const data = { ...req.query, ...req.body };
        console.log("📥 Datos recibidos en /traccar:", JSON.stringify(data));

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
                id: id, name: config.name, emoji: config.emoji, lat: parseFloat(lat),
                lon: parseFloat(lon), timestamp: normalizedTs, speed: parseFloat(speed) || 0
            };
            processions[id] = updateData;

            if (isMongo) {
                await LocationModel.findOneAndUpdate({ deviceId: id }, {
                    deviceId: id, name: config.name, emoji: config.emoji, lat: parseFloat(lat),
                    lon: parseFloat(lon), timestamp: normalizedTs, speed: parseFloat(speed) || 0
                }, { upsert: true });
            }
            await saveLocations(processions);
            console.log(`✅ [OK] ${config.emoji} ${config.name} (${id}) actualizada`);
            res.status(200).send('OK');
        } else {
            res.status(400).send('Missing lat/lon or id');
        }
    });

    app.get('/all-processions', async (req, res) => {
        await loadLocations();
        const list = Object.values(processions);
        const listWithAddresses = await Promise.all(list.map(async (p) => {
            return { ...p, address: await getAddress(p.lat, p.lon) };
        }));
        res.json(listWithAddresses);
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
        if (!target) return res.json({ status: 'error', message: 'No hay procesos activas actualmente.' });
        const mapsUrl = `https://www.google.com/maps?q=${target.lat},${target.lon}`;
        const address = await getAddress(target.lat, target.lon);
        const dateStr = new Date(target.timestamp).toLocaleString('es-GT', {
            timeZone: 'America/Guatemala', day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
        res.json({
            status: 'success', ...target, address, google_maps: mapsUrl,
            text: `${target.emoji} Ubicación de: ${target.name}\n🏠 Dirección: ${address}\n📍 Maps: ${mapsUrl}\n⌚ Última actualización:\n${dateStr}`
        });
    });

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // 5. Encender Servidor
    app.listen(PORT, () => {
        console.log(`\n🚀 Servidor listo en puerto ${PORT}`);
        console.log(`--------------------------------------------------------`);
    });
}

// Global Rejection Handler to avoid crashes on async edge cases
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason.message || reason);
});

init().catch(err => {
    console.error("🔥 Error crítico en init():", err);
});
