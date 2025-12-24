# 🌳 WA Green Planet AI - Worker v4.2

Sistema de bot WhatsApp multi-worker con anti-detección avanzada y Smart Queue inteligente.

## 📁 Estructura del Proyecto

```
wa-greenplanet-ai/
├── config/
│   └── index.js          # Configuración y variables de entorno
├── lib/
│   ├── index.js          # Barrel export
│   ├── utils.js          # Utilidades generales y timing
│   ├── media.js          # Gestión de multimedia + ffmpeg
│   ├── queue.js          # Smart Queue con detección de actividad
│   ├── supabase.js       # Orquestador multi-worker
│   ├── typing.js         # Simulador de typing/recording
│   ├── reactions.js      # Sistema de reacciones
│   ├── n8n.js            # Comunicación con n8n
│   └── behavior.js       # Variador de comportamiento
├── worker.js             # Archivo principal
├── package.json
├── .env.example
└── README.md
```

## 🚀 Instalación

```bash
# Clonar/copiar el proyecto
cd wa-greenplanet-ai

# Instalar dependencias
npm install

# Instalar ffmpeg (requerido para audio)
sudo apt update && sudo apt install -y ffmpeg

# Copiar y configurar variables de entorno
cp .env.example .env
nano .env
```

## ⚙️ Configuración

Edita el archivo `.env` con tus credenciales:

```env
PORT=3001
WORKER_ID=worker-1
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
N8N_WEBHOOK_URL=https://xxx/webhook/whatsapp
PUBLIC_MEDIA_URL=https://tu-dominio.com
```

## 🏃 Ejecución

### Un solo worker:
```bash
npm start
# o
node worker.js
```

### Múltiples workers con PM2:
```bash
# Iniciar 4 workers
pm2 start worker.js --name wa-worker-1 -- 
pm2 start worker.js --name wa-worker-2 --env PORT=3002 --env WORKER_ID=worker-2
pm2 start worker.js --name wa-worker-3 --env PORT=3003 --env WORKER_ID=worker-3
pm2 start worker.js --name wa-worker-4 --env PORT=3004 --env WORKER_ID=worker-4

# O usar ecosystem.config.js (ver abajo)
pm2 start ecosystem.config.js
```

## 🧠 Smart Queue v2 - Batching Inteligente

### ¿Cómo funciona?

La Smart Queue detecta cuando el usuario está **escribiendo o grabando audio** y ajusta dinámicamente el batching:

```
Usuario envía "Hola" (t=0)
    → Timer: 4s
    
Usuario empieza a escribir (t=2s)
    → Timer PAUSADO ⏸️
    
Usuario sigue escribiendo (t=5s)
    → Timer sigue pausado
    
Usuario deja de escribir (t=7s)
    → Timer REINICIA: 4s desde ahora
    
Usuario envía "tengo una pregunta" (t=8s)
    → Se añade al batch
    → Timer REINICIA: 4s
    
Silencio total por 4s (t=12s)
    → FLUSH! → Procesar ["Hola", "tengo una pregunta"]
```

### Configuración

En `config/index.js`:

```javascript
smartQueue: {
  enabled: true,
  baseWindowMs: 4000,        // Ventana base después de inactividad
  mediaWindowMs: 5000,       // Ventana extra para multimedia
  maxWaitTimeMs: 30000,      // Máximo tiempo de espera total
  maxBatchSize: 8,           // Máximo mensajes por batch
  inactivityThresholdMs: 3000,
  contextSwitchDelayMs: [1500, 3500],
}
```

### Límites de seguridad

| Límite | Valor | Propósito |
|--------|-------|-----------|
| `maxWaitTimeMs` | 30s | Evitar esperas infinitas |
| `maxBatchSize` | 8 | Evitar batches gigantes |

## 🛡️ Características Anti-Detección

- ✅ **Smart Queue** con detección de actividad del usuario
- ✅ **Timing Gaussiano** para delays más naturales
- ✅ **Sleep Mode** (1-5 AM CR) con slowdown 2.5x
- ✅ **Night Mode** (10 PM - 7 AM CR) con slowdown 1.4x
- ✅ **Typing Intermitente** - Pausas y "pensando"
- ✅ **Reacciones** aleatorias (8% probabilidad)
- ✅ **Multi-worker** con cross-worker 8%
- ✅ **Mensajes divididos** con delays entre partes
- ✅ **Audio Base64** con conversión a OGG Opus

## 📡 Payload a n8n

Cada mensaje (o batch) se envía a n8n con esta estructura:

```json
{
  "phone": "+50688889999",
  "type": "audio",
  "message": "texto del usuario\notro mensaje",
  "has_media": true,
  "media_count": 2,
  "media_list": [
    {
      "type": "image",
      "url": "https://tu-dominio.com/api/wa-greenplanet-ai/media/abc123.jpg",
      "mimetype": "image/jpeg",
      "filename": "abc123.jpg",
      "size": 45678
    },
    {
      "type": "audio",
      "url": "https://tu-dominio.com/api/wa-greenplanet-ai/media/def456.ogg",
      "mimetype": "audio/ogg",
      "filename": "def456.ogg",
      "size": 12345
    }
  ],
  "message_id": "...",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "bot_name": "GreenPlanetBot",
  "worker_id": "worker-1",
  "cr_hour": 10,
  "is_sleep_time": false
}
```

## 📤 Respuesta de n8n

### Texto simple:
```json
{
  "output": "Respuesta del bot"
}
```

### Múltiples mensajes:
```json
{
  "output": ["Mensaje 1", "Mensaje 2", "Mensaje 3"]
}
```

### Audio en Base64:
```json
{
  "type": "audio",
  "audio_base64": "...",
  "audio_mimetype": "audio/mpeg",
  "output": "Texto alternativo"
}
```

## 🔌 API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/wa-greenplanet-ai/health` | GET | Estado del worker |
| `/api/wa-greenplanet-ai/orchestration/stats` | GET | Stats de orquestación |
| `/api/wa-greenplanet-ai/send-message` | POST | Enviar mensaje de texto |
| `/api/wa-greenplanet-ai/send-audio` | POST | Enviar audio |
| `/api/wa-greenplanet-ai/media/*` | GET | Servir archivos multimedia |

## 📊 Logs de ejemplo

```
📩 [worker-1] +50688889999 [AUDIO]: "(sin texto)" 🌙
   ✓  Claim OK
📥 [worker-1] Buffer +50688889999: 1 msgs [AUDIO]
   ⏸️  [worker-1] Usuario activo - esperando...
   ⌨️  [worker-1] Usuario 889999: typing
   💤 [worker-1] Usuario 889999: available
   ▶️  [worker-1] Usuario inactivo - flush en 5000ms

📩 [worker-1] +50688889999: "y además quería..." 🌙
   ✓  Claim OK
📥 [worker-1] Buffer +50688889999: 2 msgs
   📦 [worker-1] Batch: 2 msgs [audio] (esperó 8234ms)

🤖 [worker-1] Procesando +50688889999 [AUDIO]
   📊 Chars: 42 | Batch: 2 | Medias: 1
   👁️  Visto
   📖 Leyendo: 3456ms
   🎙️  Grabando
   🤖 n8n: 2345ms
   🎵 Enviando audio: resp_abc123.ogg
   ✅ Audio enviado | 8765ms
```

## 🔧 Troubleshooting

### Audio no funciona en móvil
Verifica que ffmpeg esté instalado:
```bash
ffmpeg -version
```

### Mensajes no se agrupan
Revisa los logs para ver si la detección de actividad está funcionando:
```
⌨️  [worker-1] Usuario 889999: typing
```

### Error de Supabase
Verifica las credenciales y que las funciones RPC existan:
- `worker_heartbeat`
- `try_claim_message`
- `mark_message_processed`
- `cleanup_old_data`

## 📝 Licencia

Privado - Green Planet AI
