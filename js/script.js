
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// UI Elements
const instructions = document.getElementById('instructions');
const controls = document.getElementById('controls');
const angleInput = document.getElementById('angleInput');
const angleSlider = document.getElementById('angleSlider');
const speedSlider = document.getElementById('speedSlider');
const bounceInput = document.getElementById('bounceInput'); // Modificado
const settingsPanel = document.getElementById('settingsPanel');
const btnMinus = document.getElementById('btnMinus');
const btnPlus = document.getElementById('btnPlus');
const btnReset = document.getElementById('btnReset');
const btnConfigToggle = document.getElementById('btnConfigToggle');
const btnAnimate = document.getElementById('btnAnimate');
const statsDiv = document.getElementById('stats');
const bounceCountSpan = document.getElementById('bounceCount');

// State
let width, height;
let points = [];
let isClosed = false;
let laser = null; // { x, y, wallIndex, t }
let laserAngle = 45; 
let maxBounces = 10; // Default

// Animation State
let isAnimating = false;
let animationProgress = 1.0; // 0.0 to 1.0 (1.0 means fully drawn)
let animationSpeed = 0.015; // Default (Slider value 30 approx)
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

// Math Helpers
function dist(p1, p2) {
    return Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
}

function dot(v1, v2) {
    return v1.x * v2.x + v1.y * v2.y;
}

function normalize(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    return { x: v.x / len, y: v.y / len };
}

// Intersection
function getIntersection(rayOrigin, rayDir, p1, p2) {
    const denominator = rayDir.x * (p1.y - p2.y) - rayDir.y * (p1.x - p2.x);
    if (denominator === 0) return null;

    const t = ((p1.x - rayOrigin.x) * (p1.y - p2.y) - (p1.y - rayOrigin.y) * (p1.x - p2.x)) / denominator;
    const u = -((p1.x - rayOrigin.x) * rayDir.y - (p1.y - rayOrigin.y) * rayDir.x) / denominator;

    if (t > 0.001 && u >= 0 && u <= 1) {
        return {
            x: rayOrigin.x + t * rayDir.x,
            y: rayOrigin.y + t * rayDir.y,
            dist: t,
            wallIndex: -1
        };
    }
    return null;
}

// Interaction Logic
canvas.addEventListener('mousedown', (e) => {
    if (isAnimating) stopAnimation(); // Stop animation if user interacts

    const rect = canvas.getBoundingClientRect();
    const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (!isClosed) {
        // Drawing Polygon
        if (points.length > 2 && dist(mouse, points[0]) < 20) {
            isClosed = true;
            finishPolygonSetup();
        } else {
            points.push(mouse);
        }
    } else {
        // Placing Laser
        findClosestWallPoint(mouse);
    }
    draw();
});

function ensureCounterClockwise(puntos) {
    let sum = 0;
    for (let i = 0; i < puntos.length; i++) {
        const p1 = puntos[i];
        const p2 = puntos[(i + 1) % puntos.length];
        sum += (p2.x - p1.x) * (p2.y + p1.y);
    }
    
    // En coordenadas de pantalla (Y hacia abajo), 
    // una suma NEGATIVA (< 0) indica sentido HORARIO.
    // Nosotros queremos Antihorario, así que si es < 0, invertimos.
    if (sum < 0) { 
        return puntos.reverse();
    }
    
    return puntos;
}

function finishPolygonSetup() {
    instructions.innerHTML = `
        <span class="text-cyan-400 font-bold">¡Polígono cerrado!</span><br>
        Usa los controles para ajustar el experimento.
    `;
    controls.classList.remove('hidden');
    statsDiv.classList.remove('hidden');

    // Forzamos el orden de los puntos antes de guardar el estado final
    points = ensureCounterClockwise(points); 
    
    laser = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
        wallIndex: 0
    };
    draw();
}

function findClosestWallPoint(mouse) {
    let minDesc = Infinity;
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
        if (d < minDesc) {
            minDesc = d;
            closest = { ...proj, wallIndex: i };
        }
    }

    if (closest && minDesc < 30) { 
        laser = closest;
    }
}

// UI Logic
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

// Bounce Input Logic (MODIFICADO)
function updateBounces(val) {
    let num = parseInt(val);
    if (isNaN(num)) return;
    if (num < 1) num = 1;
    if (num > 1000) num = 1000; // Cap to prevent infinite loops
    maxBounces = num;
    if (isAnimating) stopAnimation();
    draw();
}

bounceInput.addEventListener('input', (e) => updateBounces(e.target.value));
bounceInput.addEventListener('change', (e) => updateBounces(e.target.value));

// Speed Slider Logic
function updateSpeed(val) {
    const factor = parseInt(val);
    // Formula: minSpeed + (factor/100 * range)
    // 0.001 (very slow) to 0.08 (fast)
    animationSpeed = 0.001 + (factor / 100) * 0.08;
}
// Initialize speed
updateSpeed(speedSlider.value);

speedSlider.addEventListener('input', (e) => {
    updateSpeed(e.target.value);
});

btnMinus.addEventListener('click', () => updateAngle(laserAngle - 1));
btnPlus.addEventListener('click', () => updateAngle(laserAngle + 1));

btnConfigToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    if(settingsPanel.classList.contains('hidden')){
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
    isClosed = false;
    laser = null;
    controls.classList.add('hidden');
    statsDiv.classList.add('hidden');
    instructions.innerHTML = "1. Haz clic en el área negra para añadir vértices.<br>2. Cierra el polígono haciendo clic cerca del punto inicial.";
    settingsPanel.classList.add('hidden');
    draw();
});

// Animation Logic
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

// Draw Loop
function draw() {
    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let x=0; x<width; x+=50) { ctx.moveTo(x,0); ctx.lineTo(x,height); }
    for(let y=0; y<height; y+=50) { ctx.moveTo(0,y); ctx.lineTo(width,y); }
    ctx.stroke();

    // Polygon
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

        ctx.fillStyle = '#f8fafc';
        for (let p of points) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Closing hint
        if (!isClosed && points.length > 2) {
            ctx.beginPath();
            ctx.strokeStyle = '#64748b';
            ctx.setLineDash([5, 5]);
            ctx.moveTo(points[points.length-1].x, points[points.length-1].y);
            ctx.lineTo(points[0].x, points[0].y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    if (isClosed && laser) {
        calculateAndDrawLaser();
    }
}

function calculateAndDrawLaser() {
    // 1. Calculate the FULL path first to determine total length
    const pathSegments = [];
    
    const p1 = points[laser.wallIndex];
    const p2 = points[(laser.wallIndex + 1) % points.length];
    
    const wallVec = { x: p2.x - p1.x, y: p2.y - p1.y };
    const wallAngle = Math.atan2(wallVec.y, wallVec.x);
    
    const rad = (laserAngle * Math.PI) / 180;
    const globalAngle = wallAngle - Math.PI + rad; 
    
    let rayDir = { x: Math.cos(globalAngle), y: Math.sin(globalAngle) };
    let rayOrigin = { x: laser.x, y: laser.y };
    
    let bounces = 0;
    let totalPathLength = 0;

    // --- CALCULATION PHASE ---
    for (let b = 0; b < maxBounces; b++) {
        let closestHit = null;
        let minDist = Infinity;
        let hitWallNormal = null;
        let hitWallVector = null;

        for (let i = 0; i < points.length; i++) {
            const w1 = points[i];
            const w2 = points[(i + 1) % points.length];

            const hit = getIntersection(rayOrigin, rayDir, w1, w2);

            if (hit && hit.dist < minDist) {
                minDist = hit.dist;
                closestHit = hit;
                
                const dx = w2.x - w1.x;
                const dy = w2.y - w1.y;
                hitWallVector = normalize({x: dx, y: dy});
                hitWallNormal = normalize({ x: -dy, y: dx }); 
            }
        }

        if (closestHit) {
            // Store segment
            const segment = {
                p1: { ...rayOrigin },
                p2: { x: closestHit.x, y: closestHit.y },
                length: minDist,
                isInfinity: false,
                hitInfo: {
                    pos: closestHit,
                    wallVec: hitWallVector,
                    normal: hitWallNormal,
                    inRay: rayDir, // current incoming
                }
            };
            pathSegments.push(segment);
            totalPathLength += minDist;

            // Reflect
            const dDotN = dot(rayDir, hitWallNormal);
            let rx = rayDir.x - 2 * dDotN * hitWallNormal.x;
            let ry = rayDir.y - 2 * dDotN * hitWallNormal.y;
            let reflectedRayDir = { x: rx, y: ry };

            segment.hitInfo.outRay = reflectedRayDir;

            rayDir = reflectedRayDir;
            rayOrigin = { x: closestHit.x, y: closestHit.y };
            bounces++;
        } else {
            // Infinity
            const infDist = 2000;
            pathSegments.push({
                p1: { ...rayOrigin },
                p2: { x: rayOrigin.x + rayDir.x * infDist, y: rayOrigin.y + rayDir.y * infDist },
                length: infDist,
                isInfinity: true,
                hitInfo: null
            });
            totalPathLength += infDist;
            break;
        }
    }
    
    // --- DRAWING PHASE ---
    // Draw Source
    ctx.beginPath();
    ctx.fillStyle = '#ef4444'; 
    ctx.arc(laser.x, laser.y, 6, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '12px sans-serif';
    ctx.fillText("L", laser.x - 4, laser.y - 10);
    
    // Always draw source angle
    let initialRayDir = { x: Math.cos(globalAngle), y: Math.sin(globalAngle) };
    drawAngleVisualization(laser, { x: p2.x - p1.x, y: p2.y - p1.y }, initialRayDir, laserAngle, true);

    // Calculate drawing limits based on animation
    let lengthToDraw = totalPathLength * animationProgress;
    let drawnLength = 0;

    ctx.beginPath();
    ctx.moveTo(laser.x, laser.y);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#22d3ee';

    for (let i = 0; i < pathSegments.length; i++) {
        const seg = pathSegments[i];
        
        // Check if we can draw this full segment
        if (drawnLength + seg.length <= lengthToDraw) {
            // Draw Full
            ctx.lineTo(seg.p2.x, seg.p2.y);
            drawnLength += seg.length;
        } else {
            // Draw Partial
            const remaining = lengthToDraw - drawnLength;
            if (remaining > 0) {
                const ratio = remaining / seg.length;
                const endX = seg.p1.x + (seg.p2.x - seg.p1.x) * ratio;
                const endY = seg.p1.y + (seg.p2.y - seg.p1.y) * ratio;
                ctx.lineTo(endX, endY);
            }
            drawnLength += remaining; // Maxed out
            break; // Stop processing segments
        }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw Angles Overlay (Only for fully reached intersections)
    // We re-iterate to draw angles on top
    let angleLengthTracker = 0;
    for (let i = 0; i < pathSegments.length; i++) {
        const seg = pathSegments[i];
        angleLengthTracker += seg.length;
        
        // If animation has passed this intersection point, draw the angles
        if (angleLengthTracker <= lengthToDraw && !seg.isInfinity && seg.hitInfo) {
            const h = seg.hitInfo;
            const incidentAngleRad = Math.acos(Math.abs(dot(h.inRay, h.wallVec)));
            const incidentAngleDeg = Math.round(incidentAngleRad * 180 / Math.PI);
            
            // Angle In
            drawAngleVisualization(h.pos, h.wallVec, h.inRay, incidentAngleDeg, false);
            
            // Angle Out (only if there is a next segment)
            if (i < pathSegments.length - 1) {
                drawAngleVisualization(h.pos, h.wallVec, h.outRay, incidentAngleDeg, true);
            }
        }
    }
    
    // If animation finished, update text
    if (animationProgress >= 1.0) {
        bounceCountSpan.innerText = bounces;
    }
}

function drawAngleVisualization(pos, wallVec, rayDir, angleDeg, isSource) {
    const radius = 25;
    
    ctx.save();
    ctx.translate(pos.x, pos.y);
    
    let vRay = isSource ? {x: rayDir.x, y: rayDir.y} : {x: -rayDir.x, y: -rayDir.y};
    let vWall = {x: wallVec.x, y: wallVec.y};
    
    if (dot(vRay, vWall) < 0) {
        vWall.x = -vWall.x;
        vWall.y = -vWall.y;
    }
    
    const angWall = Math.atan2(vWall.y, vWall.x);
    const angRay = Math.atan2(vRay.y, vRay.x);
    
    let diff = angRay - angWall;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    
    ctx.beginPath();
    ctx.strokeStyle = '#fbbf24'; 
    ctx.lineWidth = 2;
    ctx.arc(0, 0, radius, angWall, angWall + diff, diff < 0);
    ctx.stroke();
    
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 11px monospace';
    
    const midAngle = angWall + diff / 2;
    const textDist = radius + 15;
    const tx = Math.cos(midAngle) * textDist;
    const ty = Math.sin(midAngle) * textDist;
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(angleDeg.toFixed(0) + "°", tx, ty);
    
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
}
