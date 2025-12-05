const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// UI Elements
const instructions = document.getElementById('instructions');
const controls = document.getElementById('controls');
const angleInput = document.getElementById('angleInput');
const angleSlider = document.getElementById('angleSlider');
const speedSlider = document.getElementById('speedSlider');
const bounceInput = document.getElementById('bounceInput');
const settingsPanel = document.getElementById('settingsPanel');
const btnMinus = document.getElementById('btnMinus');
const btnPlus = document.getElementById('btnPlus');
const btnReset = document.getElementById('btnReset');
const btnConfigToggle = document.getElementById('btnConfigToggle');
const btnAnimate = document.getElementById('btnAnimate');
const statsDiv = document.getElementById('stats');
const bounceCountSpan = document.getElementById('bounceCount');
const modeInstructions = document.getElementById('modeInstructions');

// Controles de refracción
const btnModeReflection = document.getElementById('btnModeReflection');
const btnModeRefraction = document.getElementById('btnModeRefraction');
const refractionControls = document.getElementById('refractionControls');
const nSlider = document.getElementById('nSlider');
const nValueDisplay = document.getElementById('nValueDisplay');
const btnAddMedium = document.getElementById('btnAddMedium');
const btnClearMedia = document.getElementById('btnClearMedia');
const mediaList = document.getElementById('mediaList');

// State
let width, height;
let points = []; // Puntos del polígono principal
let isClosed = false;
let laser = null;
let laserAngle = 45;
let maxBounces = 10;

// Estado para medios
let media = []; // Array de medios { name, n, color, points, isDrawing }
let isDrawingMedium = false;
let currentMediumIndex = -1;
let simulationMode = 'reflection'; // 'reflection' o 'refraction'
let refractiveIndex = 1.5;

// Animation State
let isAnimating = false;
let animationProgress = 1.0;
let animationSpeed = 0.015;
let animationId = null;

// Resize handling
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    if (!isAnimating) draw();
}
window.addEventListener('resize', resize);
resize();

// ==================== FUNCIONES MATEMÁTICAS ====================

function dist(p1, p2) {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

function dot(v1, v2) {
    return v1.x * v2.x + v1.y * v2.y;
}

function normalize(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
}

// Intersección rayo-segmento
function getIntersection(rayOrigin, rayDir, p1, p2) {
    const denominator = rayDir.x * (p1.y - p2.y) - rayDir.y * (p1.x - p2.x);
    if (Math.abs(denominator) < 0.0001) return null;

    const t = ((p1.x - rayOrigin.x) * (p1.y - p2.y) - (p1.y - rayOrigin.y) * (p1.x - p2.x)) / denominator;
    const u = -((p1.x - rayOrigin.x) * rayDir.y - (p1.y - rayOrigin.y) * rayDir.x) / denominator;

    if (t > 0.001 && u >= 0 && u <= 1) {
        return {
            x: rayOrigin.x + t * rayDir.x,
            y: rayOrigin.y + t * rayDir.y,
            dist: t
        };
    }
    return null;
}

// Función CRÍTICA: Asegurar orden antihorario
function ensureCounterClockwise(polygon) {
    if (polygon.length < 3) return polygon;

    // Calcular área con signo (fórmula del lazo)
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
    }

    // En coordenadas de pantalla (Y hacia abajo):
    // Área positiva = sentido horario (CW)
    // Área negativa = sentido antihorario (CCW) ← LO QUE QUEREMOS
    if (area > 0) {
        // Está en sentido horario, invertir
        return polygon.slice().reverse();
    }

    return polygon;
}

// Punto dentro de polígono
function isPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Refracción
function refract(incident, normal, n1, n2) {
    // Caso especial: mismos índices de refracción (sin refracción)
    if (Math.abs(n1 - n2) < 0.0001) {
        return { x: incident.x, y: incident.y };
    }
    
    const i = normalize(incident);
    const n = normalize(normal);
    
    const eta = n1 / n2;
    const cosi = -dot(i, n);
    const sin2t = eta * eta * (1.0 - cosi * cosi);
    
    if (sin2t > 1.0) {
        return null; // Reflexión interna total
    }
    
    const cost = Math.sqrt(Math.max(0, 1.0 - sin2t));
    
    // Fórmula vectorial de refracción
    const rx = eta * i.x + (eta * cosi - cost) * n.x;
    const ry = eta * i.y + (eta * cosi - cost) * n.y;
    
    return normalize({ x: rx, y: ry });
}

// Reflexión
function reflect(dir, normal) {
    const dDotN = dot(dir, normal);
    return {
        x: dir.x - 2 * dDotN * normal.x,
        y: dir.y - 2 * dDotN * normal.y
    };
}

// ==================== INTERACCIÓN ====================

canvas.addEventListener('mousedown', (e) => {
    if (isAnimating) stopAnimation();

    const rect = canvas.getBoundingClientRect();
    const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (isDrawingMedium) {
        // Estamos dibujando un medio
        const medium = media[currentMediumIndex];

        // Cerrar medio si hacemos clic cerca del primer punto
        if (medium.points.length > 2 && dist(mouse, medium.points[0]) < 20) {
            medium.points = ensureCounterClockwise(medium.points);
            medium.isDrawing = false;
            isDrawingMedium = false;
            currentMediumIndex = -1;

            instructions.innerHTML = `
                <span class="text-green-400 font-bold">¡Medio creado!</span><br>
                El rayo se refractará al atravesar este medio.
            `;

            updateMediaList();
        } else {
            // Añadir punto al medio
            medium.points.push(mouse);
        }
    } else if (!isClosed) {
        // Dibujar polígono principal
        if (points.length > 2 && dist(mouse, points[0]) < 20) {
            isClosed = true;
            finishPolygonSetup();
        } else {
            points.push(mouse);
        }
    } else {
        // Colocar láser
        findClosestWallPoint(mouse);
    }

    draw();
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawingMedium) return;

    const rect = canvas.getBoundingClientRect();
    const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // Redibujar con línea temporal
    draw();

    // Dibujar línea temporal para el medio
    const medium = media[currentMediumIndex];
    if (medium.points.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.moveTo(medium.points[medium.points.length - 1].x,
            medium.points[medium.points.length - 1].y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Mostrar punto de cierre
        if (medium.points.length >= 3 && dist(mouse, medium.points[0]) < 30) {
            ctx.beginPath();
            ctx.arc(medium.points[0].x, medium.points[0].y, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#8b5cf680';
            ctx.fill();
        }
    }
});

function findClosestWallPoint(mouse) {
    let minDist = Infinity;
    let closest = null;

    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];

        const l2 = dist(p1, p2) ** 2;
        if (l2 === 0) continue;
        let t = ((mouse.x - p1.x) * (p2.x - p1.x) + (mouse.y - p1.y) * (p2.y - p1.y)) / l2;
        t = Math.max(0, Math.min(1, t));

        const proj = {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y)
        };

        const d = dist(mouse, proj);
        if (d < minDist) {
            minDist = d;
            closest = { ...proj, wallIndex: i };
        }
    }

    if (closest && minDist < 30) {
        laser = closest;
    }
}

// ==================== FUNCIONES DE MEDIOS ====================

function setSimulationMode(mode) {
    simulationMode = mode;

    // Actualizar botones
    btnModeReflection.classList.toggle('active', mode === 'reflection');
    btnModeRefraction.classList.toggle('active', mode === 'refraction');

    // Mostrar/ocultar controles de refracción
    refractionControls.classList.toggle('hidden', mode === 'reflection');

    // Actualizar instrucciones
    if (mode === 'reflection') {
        modeInstructions.textContent = '* Haz clic en las paredes para reposicionar el láser.';
    } else {
        modeInstructions.textContent = '* Usa "Añadir Medio" para dibujar zonas de refracción.';
    }

    // Detener animación y redibujar
    stopAnimation();
    draw();
}

function updateRefractiveIndex(value) {
    refractiveIndex = parseFloat(value) / 100;
    nSlider.value = value;
    nValueDisplay.textContent = refractiveIndex.toFixed(2);

    // Actualizar todos los medios en dibujo
    media.forEach(medium => {
        if (medium.isDrawing) {
            medium.n = refractiveIndex;
        }
    });

    if (isAnimating) stopAnimation();
    draw();
}

function addMedium() {
    if (!isClosed) {
        alert('Primero debes cerrar el polígono principal.');
        return;
    }

    // Crear nuevo medio
    const medium = {
        name: `Medio ${media.length + 1}`,
        n: refractiveIndex,
        color: getRandomMediumColor(),
        points: [],
        isDrawing: true
    };

    media.push(medium);
    currentMediumIndex = media.length - 1;
    isDrawingMedium = true;

    instructions.innerHTML = `
        <span class="text-purple-400 font-bold">Dibujando medio</span><br>
        1. Haz clic para añadir vértices<br>
        2. Cierra haciendo clic cerca del primer punto
    `;

    updateMediaList();
    draw();
}

function clearMedia() {
    media = [];
    isDrawingMedium = false;
    currentMediumIndex = -1;
    updateMediaList();
    draw();
}

function updateMediaList() {
    mediaList.innerHTML = '';

    media.forEach((medium, index) => {
        const item = document.createElement('div');
        item.className = 'medium-item';
        item.innerHTML = `
            <div class="flex items-center">
                <div class="medium-color" style="background: ${medium.color}"></div>
                <span>${medium.name}</span>
            </div>
            <span class="text-cyan-400">n=${medium.n}</span>
        `;
        mediaList.appendChild(item);
    });

    if (media.length === 0) {
        mediaList.innerHTML = '<div class="text-gray-500 text-center py-2">No hay medios</div>';
    }
}

function getRandomMediumColor() {
    const colors = [
        'rgba(59, 130, 246, 0.4)',  // Azul
        'rgba(16, 185, 129, 0.4)',  // Verde
        'rgba(245, 158, 11, 0.4)',  // Amarillo
        'rgba(244, 63, 94, 0.4)',   // Rojo
        'rgba(139, 92, 246, 0.4)'   // Púrpura
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Obtener medio en un punto
function getMediumAtPoint(x, y) {
    const point = { x, y };

    // Verificar cada medio en orden inverso (el último dibujado está arriba)
    for (let i = media.length - 1; i >= 0; i--) {
        const medium = media[i];
        if (!medium.isDrawing && isPointInPolygon(point, medium.points)) {
            return i; // Está dentro de este medio
        }
    }

    return -1; // Aire/vacío
}

// Calcular normal CORREGIDA para medios
function getMediumNormal(p1, p2, mediumPoints, rayOrigin) {
    // Vector de la arista
    const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
    
    // Normal perpendicular (antihorario)
    let normal = normalize({ x: -edge.y, y: edge.x });
    
    // Determinar si el rayo viene desde dentro o fuera del medio
    const isInside = isPointInPolygon(rayOrigin, mediumPoints);
    
    // Si el rayo viene desde dentro, la normal debe apuntar hacia afuera
    // Si viene desde fuera, la normal debe apuntar hacia dentro
    // Pero para la fórmula de refracción, queremos que la normal apunte
    // hacia el medio desde el que viene el rayo
    
    // Crear un punto ligeramente hacia donde apunta la normal
    const testPoint = {
        x: p1.x + normal.x * 10,
        y: p1.y + normal.y * 10
    };
    
    // Si el testPoint está dentro del medio y el rayo viene desde fuera,
    // o si el testPoint está fuera y el rayo viene desde dentro,
    // entonces invertir la normal
    const testInside = isPointInPolygon(testPoint, mediumPoints);
    
    if ((testInside && !isInside) || (!testInside && isInside)) {
        normal = { x: -normal.x, y: -normal.y };
    }
    
    return normal;
}

// ==================== UI CONTROLS ====================

function updateAngle(val) {
    if (isAnimating) stopAnimation();
    let num = parseInt(val);
    if (isNaN(num)) return;
    if (num < 1) num = 1;
    if (num > 179) num = 179;

    laserAngle = num;
    angleInput.value = num;
    angleSlider.value = num;
    draw();
}

angleInput.addEventListener('input', (e) => updateAngle(e.target.value));
angleInput.addEventListener('change', (e) => updateAngle(e.target.value));

angleSlider.addEventListener('input', (e) => {
    if (isAnimating) stopAnimation();
    angleInput.value = e.target.value;
    laserAngle = parseInt(e.target.value);
    draw();
});

function updateBounces(val) {
    let num = parseInt(val);
    if (isNaN(num)) return;
    if (num < 1) num = 1;
    if (num > 1000) num = 1000;
    maxBounces = num;
    if (isAnimating) stopAnimation();
    draw();
}

bounceInput.addEventListener('input', (e) => updateBounces(e.target.value));
bounceInput.addEventListener('change', (e) => updateBounces(e.target.value));

function updateSpeed(val) {
    const factor = parseInt(val);
    animationSpeed = 0.001 + (factor / 100) * 0.08;
}
updateSpeed(speedSlider.value);
speedSlider.addEventListener('input', (e) => updateSpeed(e.target.value));

btnMinus.addEventListener('click', () => updateAngle(laserAngle - 1));
btnPlus.addEventListener('click', () => updateAngle(laserAngle + 1));

btnConfigToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    if (settingsPanel.classList.contains('hidden')) {
        btnConfigToggle.classList.remove('bg-slate-600', 'text-white');
        btnConfigToggle.classList.add('bg-slate-700', 'text-cyan-400');
    } else {
        btnConfigToggle.classList.remove('bg-slate-700', 'text-cyan-400');
        btnConfigToggle.classList.add('bg-slate-600', 'text-white');
    }
});

btnReset.addEventListener('click', () => {
    stopAnimation();
    points = [];
    media = [];
    isClosed = false;
    isDrawingMedium = false;
    laser = null;
    controls.classList.add('hidden');
    statsDiv.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    setSimulationMode('reflection');
    instructions.innerHTML = `
        1. Haz clic en el área negra para añadir vértices.<br>
        2. Cierra el polígono haciendo clic cerca del punto inicial.
    `;
    draw();
});

// Controles de modo
btnModeReflection.addEventListener('click', () => setSimulationMode('reflection'));
btnModeRefraction.addEventListener('click', () => setSimulationMode('refraction'));

// Controles de refracción
nSlider.addEventListener('input', (e) => updateRefractiveIndex(e.target.value));
btnAddMedium.addEventListener('click', addMedium);
btnClearMedia.addEventListener('click', clearMedia);

// Inicializar índice de refracción
updateRefractiveIndex(nSlider.value);

// ==================== ANIMACIÓN ====================

btnAnimate.addEventListener('click', () => {
    if (!isClosed || !laser) return;
    startAnimation();
});

function startAnimation() {
    if (isAnimating) cancelAnimationFrame(animationId);
    isAnimating = true;
    animationProgress = 0.0;
    loopAnimation();
}

function stopAnimation() {
    isAnimating = false;
    animationProgress = 1.0;
    if (animationId) cancelAnimationFrame(animationId);
    draw();
}

function loopAnimation() {
    if (!isAnimating) return;

    animationProgress += animationSpeed;
    if (animationProgress >= 1.0) {
        animationProgress = 1.0;
        isAnimating = false;
    }

    draw();

    if (isAnimating) {
        animationId = requestAnimationFrame(loopAnimation);
    }
}

// ==================== DIBUJADO ====================

function finishPolygonSetup() {
    // Asegurar orden antihorario
    points = ensureCounterClockwise(points);

    instructions.innerHTML = `
        <span class="text-cyan-400 font-bold">¡Polígono cerrado!</span><br>
        Usa los controles para ajustar el experimento.
    `;
    controls.classList.remove('hidden');
    statsDiv.classList.remove('hidden');

    // Posicionar láser en el centro de la primera pared
    laser = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
        wallIndex: 0
    };

    draw();
}

function draw() {
    // Fondo
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x += 50) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += 50) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Dibujar medios
    media.forEach(medium => {
        if (medium.points.length < 3) return;

        ctx.beginPath();
        ctx.moveTo(medium.points[0].x, medium.points[0].y);
        for (let i = 1; i < medium.points.length; i++) {
            ctx.lineTo(medium.points[i].x, medium.points[i].y);
        }

        if (!medium.isDrawing) {
            // Medio cerrado: dibujar relleno
            ctx.closePath();
            ctx.fillStyle = medium.color;
            ctx.fill();

            // Borde del medio
            ctx.strokeStyle = medium.color.replace('0.4', '0.8');
            ctx.lineWidth = 2;
            ctx.stroke();

            // Etiqueta del medio
            if (medium.points.length > 0) {
                const center = { x: 0, y: 0 };
                medium.points.forEach(p => {
                    center.x += p.x;
                    center.y += p.y;
                });
                center.x /= medium.points.length;
                center.y /= medium.points.length;

                ctx.fillStyle = 'white';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`n=${medium.n}`, center.x, center.y);
            }
        } else {
            // Medio en dibujo: solo contorno
            ctx.strokeStyle = '#8b5cf6';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Puntos del medio en dibujo
            ctx.fillStyle = '#8b5cf6';
            medium.points.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    });

    // Polígono principal
    if (points.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = isClosed ? '#94a3b8' : '#cbd5e1';
        ctx.lineWidth = 3;
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        if (isClosed) ctx.closePath();
        ctx.stroke();

        // Puntos del polígono
        ctx.fillStyle = '#f8fafc';
        for (let p of points) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ayuda para cerrar
        if (!isClosed && points.length > 2) {
            ctx.beginPath();
            ctx.strokeStyle = '#64748b';
            ctx.setLineDash([5, 5]);
            ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
            ctx.lineTo(points[0].x, points[0].y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    if (isClosed && laser) {
        calculateAndDrawLaser();
    }
}

// ==================== CÁLCULO DEL LÁSER ====================

function calculateAndDrawLaser() {
    const pathSegments = [];
    let totalPathLength = 0;
    
    // Configuración inicial
    const p1 = points[laser.wallIndex];
    const p2 = points[(laser.wallIndex + 1) % points.length];
    const wallVec = { x: p2.x - p1.x, y: p2.y - p1.y };
    const wallAngle = Math.atan2(wallVec.y, wallVec.x);
    
    const rad = (laserAngle * Math.PI) / 180;
    const globalAngle = wallAngle - Math.PI + rad;
    
    let rayDir = { x: Math.cos(globalAngle), y: Math.sin(globalAngle) };
    let rayOrigin = { x: laser.x, y: laser.y };
    
    // Medio actual (aire = 1.0)
    let currentMedium = getMediumAtPoint(rayOrigin.x, rayOrigin.y);
    let n1 = currentMedium === -1 ? 1.0 : media[currentMedium].n;
    
    let bounces = 0;
    let maxIterations = maxBounces * 3; // Límite de seguridad
    
    for (let iter = 0; iter < maxIterations && bounces < maxBounces; iter++) {
        const segmentN1 = n1;
        let closestHit = null;
        let minDist = Infinity;
        let hitNormal = null;
        let hitWallVec = null;
        let hitType = 'wall'; // 'wall' o 'medium'
        let hitMediumIdx = -1;
        
        // Buscar intersección más cercana
        // 1. Con el polígono principal
        for (let i = 0; i < points.length; i++) {
            if (iter === 0 && i === laser.wallIndex) continue;
            
            const w1 = points[i];
            const w2 = points[(i + 1) % points.length];
            const hit = getIntersection(rayOrigin, rayDir, w1, w2);
            
            if (hit && hit.dist < minDist && hit.dist > 0.001) {
                minDist = hit.dist;
                closestHit = hit;
                hitType = 'wall';
                
                const dx = w2.x - w1.x;
                const dy = w2.y - w1.y;
                hitWallVec = normalize({ x: dx, y: dy });
                
                // Normal que apunta hacia adentro del polígono
                let normal = normalize({ x: -dy, y: dx });
                
                // Ajustar dirección
                const toHit = { x: hit.x - rayOrigin.x, y: hit.y - rayOrigin.y };
                if (dot(toHit, normal) < 0) {
                    normal = { x: -normal.x, y: -normal.y };
                }
                
                hitNormal = normal;
            }
        }
        
        // 2. Con medios (solo en modo refracción)
        if (simulationMode === 'refraction') {
            for (let i = 0; i < media.length; i++) {
                const medium = media[i];
                if (medium.isDrawing || medium.points.length < 3) continue;
                
                for (let j = 0; j < medium.points.length; j++) {
                    const w1 = medium.points[j];
                    const w2 = medium.points[(j + 1) % medium.points.length];
                    const hit = getIntersection(rayOrigin, rayDir, w1, w2);
                    
                    if (hit && hit.dist < minDist && hit.dist > 0.001) {
                        minDist = hit.dist;
                        closestHit = hit;
                        hitType = 'medium';
                        hitMediumIdx = i;
                        
                        // Calcular normal para el medio
                        hitNormal = getMediumNormal(w1, w2, medium.points, rayOrigin);
                        const dx = w2.x - w1.x;
                        const dy = w2.y - w1.y;
                        hitWallVec = normalize({ x: dx, y: dy });
                    }
                }
            }
        }
        
        if (!closestHit) {
            // Rayo al infinito
            const infDist = 2000;
            pathSegments.push({
                p1: { ...rayOrigin },
                p2: { x: rayOrigin.x + rayDir.x * infDist, y: rayOrigin.y + rayDir.y * infDist },
                length: infDist,
                n1: n1,
                isRefraction: false
            });
            totalPathLength += infDist;
            break;
        }
        
        // Determinar el nuevo índice de refracción
        let n2 = 1.0; // Por defecto aire
        let isRefraction = false;
        let isEntering = false;
        
        if (hitType === 'wall') {
            // Pared del polígono principal: siempre reflexión
            n2 = n1;
            isRefraction = false;
        } else if (hitType === 'medium') {
            const medium = media[hitMediumIdx];
            
            // Determinar si estamos entrando o saliendo del medio
            const rayInMedium = currentMedium === hitMediumIdx;
            
            if (rayInMedium) {
                // SALIENDO del medio → medio → aire
                n2 = 1.0;
                isEntering = false;
            } else {
                // ENTRANDO al medio → aire → medio
                n2 = medium.n;
                isEntering = true;
            }
            
            // Siempre intentar refracción en modo refracción
            isRefraction = simulationMode === 'refraction';
            
            // Caso especial: si n1 == n2, no hay refracción real
            if (Math.abs(n1 - n2) < 0.0001) {
                isRefraction = false; // No hay refracción
            }
        }
        
        // Asegurar que la normal esté orientada hacia el medio de origen (hacia el rayo incidente)
        let normalForCalc = hitNormal;
        if (dot(rayDir, normalForCalc) > 0) {
            normalForCalc = { x: -normalForCalc.x, y: -normalForCalc.y };
        }

        // Calcular ángulo de incidencia usando la normal orientada
        const cosTheta = Math.abs(dot(normalize(rayDir), normalize(hitWallVec)));
        const incidentAngle = Math.acos(Math.min(1, cosTheta)) * 180 / Math.PI;

        // Determinar nueva dirección del rayo
        let newRayDir = null;
        let refractedAngle = null;

        if (isRefraction && Math.abs(n1 - n2) > 0.001) {
            // Intentar refracción usando la normal orientada
            const refractedDir = refract(rayDir, normalForCalc, n1, n2);

            if (refractedDir) {
                // Refracción exitosa
                newRayDir = refractedDir;

                // Angulo refractado respecto a la PARED
                const cosr = Math.min(1, Math.abs(dot(refractedDir, hitWallVec)));
                refractedAngle = Math.acos(cosr) * 180 / Math.PI;

                // Actualizar medio actual si cruzamos un medio
                if (hitType === 'medium') {
                    if (isEntering) {
                        currentMedium = hitMediumIdx;
                    } else {
                        currentMedium = -1;
                    }
                    // Actualizar n1 para el siguiente segmento
                    n1 = currentMedium === -1 ? 1.0 : media[currentMedium].n;
                }
            } else {
                // Reflexión interna total
                newRayDir = reflect(rayDir, normalForCalc);
                bounces++;
            }
        } else {
            // Modo reflexión O n1 == n2 (sin refracción)
            if (hitType === 'medium' && Math.abs(n1 - n2) < 0.0001) {
                // n1 == n2: continuar en la misma dirección (sin refracción ni reflexión)
                newRayDir = { x: rayDir.x, y: rayDir.y };
                
                // Actualizar medio actual si cruzamos un medio
                if (isEntering) {
                    currentMedium = hitMediumIdx;
                } else {
                    currentMedium = -1;
                }
                // Actualizar n1 para el siguiente segmento
                n1 = currentMedium === -1 ? 1.0 : media[currentMedium].n;
            } else {
                // Reflexión normal
                newRayDir = reflect(rayDir, normalForCalc);
                bounces++;
            }
        }
        
        // Almacenar segmento
        const segment = {
            p1: { ...rayOrigin },
            p2: { x: closestHit.x, y: closestHit.y },
            length: minDist,
            n1: segmentN1,
            n2: n2,
            hitPoint: { x: closestHit.x, y: closestHit.y },
            hitNormal: hitNormal,
            hitWallVec: hitWallVec,
            rayDirIn: { ...rayDir },
            rayDirOut: newRayDir,
            isRefraction: isRefraction,
            isEntering: isEntering,
            hitType: hitType,
            incidentAngle: incidentAngle,
            refractedAngle: refractedAngle
        };
        
        pathSegments.push(segment);
        totalPathLength += minDist;
        
        // Actualizar para siguiente iteración
        rayDir = normalize(newRayDir);
        rayOrigin = { x: closestHit.x, y: closestHit.y };
    }
    
    // ========== DIBUJAR ==========
    
    // Dibujar fuente láser
    ctx.beginPath();
    ctx.fillStyle = '#ef4444';
    ctx.arc(laser.x, laser.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("L", laser.x, laser.y);
    
    // Dibujar trayectoria
    let drawnLength = 0;
    const lengthToDraw = totalPathLength * animationProgress;
    
    ctx.beginPath();
    ctx.moveTo(laser.x, laser.y);
    
    for (let i = 0; i < pathSegments.length; i++) {
        const seg = pathSegments[i];
        
        // Color según el medio
        let segColor = '#22d3ee'; // Aire
        let segWidth = 3;
        
        if (seg.n1 > 1.0) {
            segColor = '#10b981'; // Dentro de medio
            segWidth = 4;
        }
        
        if (seg.isRefraction) {
            segColor = '#8b5cf6'; // Punto de refracción
            segWidth = 5;
        }
        
        ctx.strokeStyle = segColor;
        ctx.lineWidth = segWidth;
        ctx.shadowBlur = 15;
        ctx.shadowColor = segColor;
        
        if (drawnLength + seg.length <= lengthToDraw) {
            ctx.lineTo(seg.p2.x, seg.p2.y);
            drawnLength += seg.length;
        } else {
            const remaining = lengthToDraw - drawnLength;
            if (remaining > 0) {
                const ratio = remaining / seg.length;
                const endX = seg.p1.x + (seg.p2.x - seg.p1.x) * ratio;
                const endY = seg.p1.y + (seg.p2.y - seg.p1.y) * ratio;
                ctx.lineTo(endX, endY);
            }
            break;
        }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    // Dibujar puntos de interacción y ángulos
    let angleLengthTracker = 0;
    
    for (let i = 0; i < pathSegments.length; i++) {
        const seg = pathSegments[i];
        angleLengthTracker += seg.length;
        
        if (angleLengthTracker <= lengthToDraw && seg.hitPoint) {
            // Dibujar punto de interacción
            ctx.beginPath();
            if (seg.isRefraction) {
                ctx.fillStyle = '#8b5cf6';
                ctx.arc(seg.hitPoint.x, seg.hitPoint.y, 7, 0, Math.PI * 2);
                ctx.fill();
                
                // Etiqueta
                ctx.fillStyle = 'white';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(seg.isEntering ? "IN" : "OUT", seg.hitPoint.x, seg.hitPoint.y + 15);
                
                // Dibujar ángulo refractado si existe
                if (seg.refractedAngle !== null) {
                    drawRefractionAngle(seg.hitPoint, seg.hitWallVec, seg.rayDirOut, seg.refractedAngle, seg.n1, seg.n2);
                }
            } else {
                ctx.fillStyle = '#fbbf24';
                ctx.arc(seg.hitPoint.x, seg.hitPoint.y, 5, 0, Math.PI * 2);
                ctx.fill();
            }
            
            if (i < pathSegments.length - 1) {

                // A. Ángulo de incidencia (Entrada)
                drawIncidenceAngle(seg.hitPoint, seg.hitWallVec, seg.rayDirIn, seg.incidentAngle);
                
                // B. Ángulo de reflexión (Salida) - Espejo
                if (!seg.isRefraction && seg.rayDirOut) {
                    const rayOutInverted = { x: -seg.rayDirOut.x, y: -seg.rayDirOut.y };
                    drawIncidenceAngle(seg.hitPoint, seg.hitWallVec, rayOutInverted, seg.incidentAngle);
                }
                
                // C. Ángulo de refracción (si aplica)
                if (seg.refractedAngle !== null) {
                    drawRefractionAngle(seg.hitPoint, seg.hitWallVec, seg.rayDirOut, seg.refractedAngle, seg.n1, seg.n2);
                }

            }
        }
    }
    
    bounceCountSpan.textContent = bounces;
}

// ==================== FUNCIONES DE ÁNGULOS ====================

function drawIncidenceAngle(pos, wallVec, rayDir, angleDeg) {
    const radius = 25;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // 1. Normalizamos vectores
    // Invertimos rayDir porque queremos el vector que "sale" del punto hacia atrás
    let vRay = normalize({ x: -rayDir.x, y: -rayDir.y });
    let vWall = normalize(wallVec);

    // 2. DETECCIÓN Y CORRECCIÓN DE OBTUSO
    // Calculamos el producto punto para ver si apuntan en direcciones opuestas
    // Si el dot es negativo, el ángulo es > 90 (obtuso).
    // En ese caso, invertimos el vector de la pared para usar el lado "agudo".
    if (dot(vRay, vWall) < 0) {
        vWall = { x: -vWall.x, y: -vWall.y };
    }

    // 3. Calculamos ángulos para el canvas
    const angWall = Math.atan2(vWall.y, vWall.x);
    const angRay = Math.atan2(vRay.y, vRay.x);

    // 4. Calcular la diferencia para el arco
    let diff = angRay - angWall;
    
    // Normalizar diff para que esté entre -PI y PI
    // Esto asegura que el arco siempre tome el camino más corto
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // 5. Dibujar
    ctx.beginPath();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    
    // El último parámetro (diff < 0) determina la dirección del reloj
    // para asegurar que siempre pintamos el sector interior
    ctx.arc(0, 0, radius, angWall, angWall + diff, diff < 0);
    ctx.stroke();

    // Texto
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 11px monospace';

    // Posición del texto (en la bisectriz del ángulo)
    const midAngle = angWall + diff / 2;
    const textDist = radius + 15;
    const tx = Math.cos(midAngle) * textDist;
    const ty = Math.sin(midAngle) * textDist;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Limpiamos un pequeño recuadro detrás del texto para que se lea bien sobre las líneas
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(tx, ty, 8, 0, Math.PI*2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(Math.round(angleDeg) + "°", tx, ty);

    // Punto central
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawRefractionAngle(pos, wallVec, refractedDir, angleDeg, n1, n2) {
    const radius = 30;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // 1. Normalización
    let vRay = normalize(refractedDir);
    let vWall = normalize(wallVec);

    // 2. CORRECCIÓN DE OBTUSO (Igual que en reflexión)
    // Si el ángulo entre el rayo saliente y la pared es > 90,
    // invertimos la pared visualmente para graficar el ángulo agudo.
    if (dot(vRay, vWall) < 0) {
        vWall = { x: -vWall.x, y: -vWall.y };
    }

    const angWall = Math.atan2(vWall.y, vWall.x);
    const angRay = Math.atan2(vRay.y, vRay.x);

    let diff = angRay - angWall;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // 3. Dibujar arco
    ctx.beginPath();
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 2]);
    ctx.arc(0, 0, radius, angWall, angWall + diff, diff < 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Textos
    ctx.fillStyle = '#8b5cf6';
    ctx.font = 'bold 12px monospace';

    const midAngle = angWall + diff / 2;
    const textDist = radius + 25; // Un poco más lejos para dar espacio
    const tx = Math.cos(midAngle) * textDist;
    const ty = Math.sin(midAngle) * textDist;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Fondo oscuro para que se lea bien sobre la grilla
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.beginPath();
    // Hacemos un fondo redondeado adaptable
    ctx.roundRect(tx - 45, ty - 12, 90, 24, 4);
    ctx.fill();

    // Texto del ángulo
    ctx.fillStyle = '#e2e8f0'; // Blanco suave
    ctx.font = 'bold 12px monospace';
    ctx.fillText(Math.round(angleDeg) + "°", tx - 20, ty);

    // Índices de refracción (más pequeños a la derecha)
    ctx.fillStyle = '#a78bfa'; // Violeta claro
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${n1.toFixed(1)}→${n2.toFixed(1)}`, tx + 5, ty + 1);

    // Punto central
    ctx.fillStyle = '#8b5cf6';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}
