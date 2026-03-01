# ✝️ Sistema de Rastreo de Procesiones

Este sistema permite monitorear múltiples procesiones en tiempo real utilizando dispositivos móviles (App Traccar) y un panel de administración centralizado. Las ubicaciones se visualizan en un mapa dinámico y se pueden consultar mediante un Chatbot de WhatsApp.

## 🚀 Inicio Rápido

### 1. Configuración del Entorno
Crea un archivo `.env` en la raíz del proyecto con los siguientes valores:
```env
PORT=3000
SESSION_SECRET=una_clave_secreta_aleatoria
ADMIN_PASSWORD=tu_contrasena_admin
TZ=America/Guatemala
MONGODB_URI=tu_url_de_mongodb_atlas (Opcional para persistencia)
```

### 2. Instalación y Ejecución
```bash
npm install
npm start
```

---

## 📱 Guía de Integración: App Traccar

Para enviar la ubicación desde un celular a este sistema, debes usar la aplicación **Traccar Client** (disponible en Android e iOS).

### Pasos en el Celular:
1. **Instalar**: Descarga "Traccar Client" desde la App Store o Play Store.
2. **Identificador del dispositivo**: 
   - Abre la app y busca el "Identificador del dispositivo" (ej: `123456`).
   - **IMPORTANTE**: Este mismo ID debe estar registrado en tu **Panel de Administración** (/admin).
3. **URL del servidor**: 
   - Introduce tu URL de Render seguida de `/traccar`.
   - Ejemplo: `https://tu-app.onrender.com/traccar`
4. **Frecuencia**: 
   - Recomendado: 30 o 60 segundos para no agotar la batería.
5. **Activar**: Enciende el interruptor de "Estado del servicio".

---

## 🛠️ Panel de Administración (/admin)

Desde aquí puedes gestionar qué dispositivos son visibles en el mapa:
- **ID del Dispositivo**: El número que aparece en la App Traccar.
- **Nombre**: El nombre que aparecerá en el mapa (ej: "Señor de las Misericordias").
- **Emoji**: Un icono representativo (ej: ✝️, ⛪, 🕯️).

---

## 🤖 Integración con Chatbot (BroadcasterBot)

El sistema ofrece un endpoint optimizado para chatbots que devuelve la ubicación formateada para WhatsApp.

- **Endpoint**: `https://tu-app.onrender.com/latest-location?id=ID_DEL_DISPOSITIVO`
- **Respuesta JSON**: El bot debe extraer el campo `text`, que ya incluye el nombre, el link a Google Maps y la hora local de Guatemala en formato 24h.

---

## 💾 Persistencia (MongoDB Atlas)

Por defecto, Render borra los datos locales al reiniciar. Para que tus configuraciones sean permanentes:
1. Crea un cluster gratuito en [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Obtén tu cadena de conexión (`MONGODB_URI`).
3. Agrégala a las variables de entorno en Render.

---

## 🗺️ Visualización
- **Mapa Público**: El mapa principal se encuentra en la raíz `/`.
- **Auto-actualización**: El mapa se refresca automáticamente cada 10 segundos para mostrar el movimiento de las procesiones.

---
*Desarrollado para la gestión de cortejos procesionales y eventos religiosos.*
