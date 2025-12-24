# 🧠 WA Antropy Engine
### Framework de Simulación de Comportamiento Humano para Automatización

> **Nota:** Este sistema actúa como una capa de "middleware cognitivo" entre el protocolo de WhatsApp y tu lógica de negocio (n8n, backend, AI), inyectando imperfecciones humanas, latencia contextual y patrones de comportamiento no deterministas para evitar la detección de automatización.

---

## 📖 Introducción

**WA Antropy Engine** es un orquestador de workers diseñado para dotar de "humanidad" (antropía) a los bots de WhatsApp. A diferencia de los bots tradicionales que responden instantáneamente y con patrones fijos, este motor simula el comportamiento psicomotor de un humano real operando un dispositivo móvil.

El sistema no solo envía mensajes, sino que "lee", "piensa", "escribe", "graba notas de voz" y "duerme" respetando ritmos circadianos y contextos de conversación, haciendo prácticamente indistinguible la actividad del bot de la de un operador humano.

---

## 🏗️ Arquitectura Técnica

El sistema utiliza una arquitectura distribuida donde el "Worker" maneja la sesión de WhatsApp y la simulación de comportamiento, mientras delegada la lógica de negocio a un cerebro externo (n8n, API propia, etc.) y el estado a una base de datos en tiempo real.

```mermaid
graph TD
    User((Usuario Real)) <-->|WhatsApp Protocol| W[Worker: Antropy Engine]
    
    subgraph "Antropy Engine Core"
        W -->|Detecta Actividad| SQ[Smart Queue]
        SQ -->|Batching & Debounce| BM[Behavior Modulator]
        BM -->|Simulación Typing/Audio| W
    end
    
    W <-->|Sync Estado & Locks| DB[(Supabase / Redis)]
    W -->|Webhook: Mensajes + Contexto| Brain[Lógica de Negocio (n8n/API)]
    Brain -->|Respuesta JSON| W
```

### Flujo de Procesamiento

1.  **Recepción y Espera Activa (Smart Queue v2):**
    *   El sistema recibe un mensaje pero no lo procesa inmediatamente.
    *   **Escucha Activa:** Si el usuario está escribiendo (`typing`) o grabando audio (`recording`), el worker **pausa** su procesamiento para no interrumpir, simulando atención humana.
    *   **Batching:** Agrupa múltiples mensajes cortos en un solo contexto lógico.

2.  **Simulación Cognitiva (Behavior Modulator):**
    *   Calcula tiempos de lectura basados en la longitud del texto y tipo de media.
    *   Determina tiempos de escritura/grabación usando distribuciones gaussianas (no tiempos fijos).
    *   Aplica "Jitter" (variación aleatoria) para evitar patrones matemáticos exactos.

3.  **Ejecución de Respuesta:**
    *   Simula estados de presencia (`composing`, `recording`).
    *   Envía la respuesta final.

---

## 🚀 Instalación y Despliegue

### Requisitos Previos

*   **Node.js**: v18.0.0 o superior.
*   **FFmpeg**: Requerido para la codificación y manipulación de audio (OGG Opus).
*   **Supabase Project**: Para la orquestación multi-worker (opcional si usa 1 solo worker, pero recomendado).

### Pasos de Instalación

1.  **Clonar el repositorio:**
    ```bash
    git clone <repo-url>
    cd wa-antropy-engine
    ```

2.  **Instalar dependencias:**
    ```bash
    npm install
    ```

3.  **Configurar FFmpeg (Linux/Debian):**
    ```bash
    sudo apt update && sudo apt install -y ffmpeg
    ```

4.  **Configuración de Entorno:**
    Copie el archivo de ejemplo y edítelo:
    ```bash
    cp .env.example .env
    ```

### Variables de Entorno (.env)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `PORT` | Puerto para la API interna del worker | `3001` |
| `WORKER_ID` | Identificador único del nodo | `worker-alpha` |
| `N8N_WEBHOOK_URL` | Endpoint del "cerebro" lógico | `https://n8n.mi-server.com/webhook/...` |
| `SUPABASE_URL` | URL del proyecto Supabase (Orquestación) | `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Key para gestión de estado | `eyJ...` |
| `TIMEZONE` | Zona horaria para ritmos circadianos | `America/Mexico_City` |

---

## 🧠 Características de Antropía (Simulación Humana)

El corazón del sistema es su capacidad de introducir "ruido humano" controlado.

### 1. Smart Queue & Escucha Activa
El sistema monitorea eventos de `chat_state_changed`.
*   **Escenario:** El usuario envía "Hola", pero inmediatamente aparece "escribiendo...".
*   **Reacción:** El bot detecta el estado `typing`, pausa su temporizador de respuesta y espera a que el usuario termine su idea completa antes de procesar el bloque de mensajes.

### 2. Modulación de Comportamiento (Behavior Variator)
Para evitar huellas digitales estadísticas, el bot cambia su "personalidad" técnica ligeramente cada `N` mensajes (configurado en `varyBehaviorEveryNMessages`).
*   Varía la velocidad de escritura (WPM).
*   Altera la probabilidad de cometer errores tipográficos.
*   Modifica los tiempos de "lectura" de imágenes/video.

### 3. Ritmos Circadianos (Modos de Sueño)
Simula horarios de vida real para reducir la actividad en horas no laborales.
*   **Sleep Mode (Madrugada):** Aumenta drásticamente los tiempos de respuesta (factor 2.5x) o ignora mensajes hasta la mañana.
*   **Night Mode (Noche):** Ralentiza las respuestas (factor 1.4x) simulando cansancio o distracción.

### 4. Simulación de Medios
*   **Audio:** Convierte audio base64 a formato nativo de WhatsApp (OGG Opus) simulando una grabación de micrófono real.
*   **Visualización:** Antes de responder a una imagen, espera un tiempo proporcional al "procesamiento visual" humano.

---

## 🔌 API Reference & Payload

El worker se comunica con su lógica de negocio (ej. n8n) mediante Webhooks.

### Request (Worker -> n8n)

Cuando el worker decide procesar un mensaje (o grupo de mensajes), envía este payload:

```json
{
  "phone": "5215555555555",
  "type": "text",
  "message": "Hola, necesito información sobre el servicio",
  "has_media": false,
  "batch_size": 1,
  "simulation_stats": {
    "read_time_ms": 1200,
    "typing_time_ms": 3400
  },
  "worker_id": "worker-alpha",
  "timestamp": "2024-03-20T10:00:00Z"
}
```

### Response (n8n -> Worker)

Su lógica de negocio debe responder con un JSON instruyendo qué hacer.

**Responder con Texto:**
```json
{
  "output": "Claro, aquí tienes la información solicitada."
}
```

**Responder con Audio (Simulado):**
```json
{
  "type": "audio",
  "audio_base64": "UklGRi...",
  "output": "Texto de fallback para logs"
}
```

**Responder Múltiples Mensajes:**
```json
{
  "output": ["Primer mensaje", "Segundo mensaje con detalle"]
}
```

---

## 🛠️ Endpoints de Control

El worker expone una API REST local para monitoreo y control manual.

*   `GET /api/wa-greenplanet-ai/health`: Estado de salud del worker y conexión a WA.
*   `GET /api/wa-greenplanet-ai/orchestration/stats`: Estadísticas de la cola inteligente y variaciones.
*   `POST /api/wa-greenplanet-ai/send-message`: Forzar envío de mensaje (bypassing queue).

---

## 🤝 Contribución y Mantenimiento

### Reporte de Bugs
Por favor, utilice el sistema de Issues describiendo el comportamiento esperado vs el observado. Incluya logs de la sección `[Behavior]` para diagnosticar problemas de timing.

### Roadmap
- [ ] Implementación de "Humor States" (variar longitud de respuesta según "ánimo").
- [ ] Soporte para stickers dinámicos basados en sentimiento.
- [ ] Integración nativa con LLMs locales para pre-procesamiento de intenciones.

### Licencia
Este software es propiedad privada. Su uso está restringido a los términos de licencia acordados.
