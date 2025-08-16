import * as THREE from 'three';
import { Vector3, Quaternion, CanvasTexture, MeshStandardMaterial, BoxGeometry, Mesh, Euler, WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight } from 'three';

let renderer: any = null;
let scene: any = null;
let camera: any = null;
let dice: [any, any] | null = null;
let rafActive = false;
let container: HTMLDivElement | null = null;
let enabled = true;
const DICE_SCALE = 0.32; // global scale for much smaller dice
const DICE_HALF_SPACING = 0.21; // tiny increase in spacing

// Chaotic roll tuning
const ROLL_DEFAULT_MS = 750; // faster overall roll
const CHAOS_SPIN_MAX = 1.35; // max extra spin radians at start, decays to 0
const CHAOS_SPIN_CPS = 9.5;  // spin cycles per second
const JITTER_POS_MAX = 0.05; // peak positional jitter at start
const JITTER_CPS = 14;       // position jitter cycles per second

// Simple animation state
type AnimState = {
    start: number;
    duration: number;
    from: [any, any];
    to: [any, any];
    axis0?: any;
    axis1?: any;
    phase0?: number;
    phase1?: number;
};
let anim: AnimState | null = null;

function makePipTexture(value: number, size = 256) {
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d')!;
    // Background with subtle gradient and rounded rect
    const r = Math.floor(size * 0.12);
    const pad = Math.floor(size * 0.05);
    const w = size - pad * 2;
    const h = size - pad * 2;
    const x = pad;
    const y = pad;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = Math.max(2, Math.floor(size * 0.02));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pips
    const pipR = Math.max(6, Math.floor(size * 0.08));
    ctx.fillStyle = '#111';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = Math.floor(size * 0.02);
    const off = size * 0.25;
    const cx = size / 2;
    const cy = size / 2;
    const positions: Record<number, Array<[number, number]>> = {
        1: [[0, 0]],
        2: [[-off, -off], [off, off]],
        3: [[-off, -off], [0, 0], [off, off]],
        4: [[-off, -off], [off, -off], [-off, off], [off, off]],
        5: [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]],
        6: [[-off, -off], [off, -off], [-off, 0], [off, 0], [-off, off], [off, off]],
    };
    for (const [dx, dy] of positions[value] || []) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, pipR, 0, Math.PI * 2);
        ctx.fill();
    }

    const tex: any = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace as any;
    return tex;
}

function makeDieMaterials() {
    // Standard die: opposite faces sum to 7
    // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z
    // Let's map them as: [right, left, top, bottom, front, back]
    const mat = [
        new THREE.MeshStandardMaterial({ map: makePipTexture(4) }), // +X right = 4
        new THREE.MeshStandardMaterial({ map: makePipTexture(3) }), // -X left = 3
        new THREE.MeshStandardMaterial({ map: makePipTexture(1) }), // +Y top = 1
        new THREE.MeshStandardMaterial({ map: makePipTexture(6) }), // -Y bottom = 6
        new THREE.MeshStandardMaterial({ map: makePipTexture(2) }), // +Z front = 2
        new THREE.MeshStandardMaterial({ map: makePipTexture(5) }), // -Z back = 5
    ];
    mat.forEach(m => { m.roughness = 0.45; m.metalness = 0.0; });
    return mat;
}

function makeDie() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const materials = makeDieMaterials();
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
}

function orientationForTop(value: number, yaw = 0) {
    // Materials on the cube:
    const faceNormalMap: Record<number, THREE.Vector3> = {
        1: new THREE.Vector3(0, 1, 0),  // +Y
        6: new THREE.Vector3(0, -1, 0),  // -Y
        2: new THREE.Vector3(0, 0, 1),  // +Z
        5: new THREE.Vector3(0, 0, -1),  // -Z
        4: new THREE.Vector3(1, 0, 0),  // +X
        3: new THREE.Vector3(-1, 0, 0),  // -X
    };

    const from = faceNormalMap[value] || faceNormalMap[1];
    const to = new Vector3(0, 1, 0); // top
    const q = new Quaternion().setFromUnitVectors(from, to);

    // Optional yaw (kept for completeness)
    if (yaw) {
        const yawQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
        q.multiply(yawQ);
    }
    return q;
    return q;
}

function ensureLoop() {
    if (rafActive || !renderer) return;
    rafActive = true;
    renderer.setAnimationLoop(() => {
        if (!renderer || !scene || !camera) return;
        // Animate dice slerp + chaos if active
        if (anim && dice) {
            const now = performance.now();
            const elapsed = (now - anim.start) / 1000;
            const t = Math.min(1, (now - anim.start) / anim.duration);
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // Base slerp toward target face-up orientation
            const q0 = dice[0].quaternion.copy(anim.from[0]).slerp(anim.to[0], ease).clone();
            const q1 = dice[1].quaternion.copy(anim.from[1]).slerp(anim.to[1], ease).clone();

            // Add decaying chaotic spin around random axes
            const spinAmp = CHAOS_SPIN_MAX * (1 - ease);
            const spinAngle0 = spinAmp * Math.sin(2 * Math.PI * CHAOS_SPIN_CPS * elapsed + (anim.phase0 || 0));
            const spinAngle1 = spinAmp * Math.sin(2 * Math.PI * CHAOS_SPIN_CPS * elapsed + (anim.phase1 || 0));
            const spinQ0 = new THREE.Quaternion().setFromAxisAngle(anim.axis0 || new THREE.Vector3(1, 0, 0), spinAngle0);
            const spinQ1 = new THREE.Quaternion().setFromAxisAngle(anim.axis1 || new THREE.Vector3(0, 1, 0), spinAngle1);

            dice[0].quaternion.copy(spinQ0.multiply(q0));
            dice[1].quaternion.copy(spinQ1.multiply(q1));

            // Positional jitter (x/z) + bob, all decaying
            const jitter = (1 - ease);
            const bob = Math.sin(elapsed * 2 * Math.PI * (JITTER_CPS * 0.35)) * 0.03 * jitter;
            const jx0 = Math.sin(2 * Math.PI * JITTER_CPS * elapsed + (anim.phase0 || 0) * 1.13) * JITTER_POS_MAX * jitter;
            const jz0 = Math.cos(2 * Math.PI * (JITTER_CPS * 0.8) * elapsed + (anim.phase0 || 0) * 0.77) * (JITTER_POS_MAX * 0.7) * jitter;
            const jx1 = Math.sin(2 * Math.PI * (JITTER_CPS * 1.1) * elapsed + (anim.phase1 || 0) * 0.91) * JITTER_POS_MAX * jitter;
            const jz1 = Math.cos(2 * Math.PI * (JITTER_CPS * 0.6) * elapsed + (anim.phase1 || 0) * 1.41) * (JITTER_POS_MAX * 0.7) * jitter;
            dice[0].position.set(-DICE_HALF_SPACING + jx0, bob, jz0);
            dice[1].position.set(DICE_HALF_SPACING + jx1, bob, jz1);

            if (t >= 1) {
                // Snap to final positions without jitter
                dice[0].position.set(-DICE_HALF_SPACING, 0, 0);
                dice[1].position.set(DICE_HALF_SPACING, 0, 0);
                anim = null;
            }
        }
        renderer.render(scene!, camera!);
    });
}

export function initThreeDice() {
    if (renderer) return;
    container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.inset = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '5';
    document.body.appendChild(container);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer!.domElement);

    scene = new THREE.Scene();
    (scene as any).background = null;

    camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
    // Look straight at the origin so dice sit visually in the middle of the ring
    camera.position.set(0, 0.4, 6);
    camera.lookAt(0, 0, 0);

    // Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.7);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(2, 6, 3);
    scene.add(dir);

    // Dice
    const d1 = makeDie();
    const d2 = makeDie();
    d1.scale.set(DICE_SCALE, DICE_SCALE, DICE_SCALE);
    d2.scale.set(DICE_SCALE, DICE_SCALE, DICE_SCALE);
    // Bring dice close together around center
    d1.position.set(-DICE_HALF_SPACING, 0, 0);
    d2.position.set(DICE_HALF_SPACING, 0, 0);
    // Start with random orientation for some life
    d1.quaternion.setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI));
    d2.quaternion.setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI));
    scene.add(d1, d2);
    dice = [d1, d2];

    ensureLoop();
}

export function setThreeDiceEnabled(v: boolean) {
    enabled = v;
    if (container) container.style.display = enabled ? 'block' : 'none';
}

export function resizeThreeDice(width: number, height: number) {
    if (!renderer || !camera) return;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

export function rollThreeDice(values: [number, number], durationMs = ROLL_DEFAULT_MS) {
    if (!dice) return;
    // random start orientations for each roll
    const startQ0 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2)
    );
    const startQ1 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2)
    );
    dice[0].quaternion.copy(startQ0);
    dice[1].quaternion.copy(startQ1);

    // target orientations with no random yaw - perfectly flat
    const targetQ0 = orientationForTop(values[0], 0);
    const targetQ1 = orientationForTop(values[1], 0);

    const randAxis = () => new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    anim = {
        start: performance.now(),
        duration: durationMs,
        from: [startQ0, startQ1],
        to: [targetQ0, targetQ1],
        axis0: randAxis(),
        axis1: randAxis(),
        phase0: Math.random() * Math.PI * 2,
        phase1: Math.random() * Math.PI * 2,
    };
}
