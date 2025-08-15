import './style.css';

// Game state
let tileCount = 20; // set via setup modal
let players = 2;
let taskCount = 5; // limited to <= 25% of tileCount
let taskTiles: Set<number> = new Set(); // 0-based tile indices with tasks
type TaskInfo = { pays: number; steps: number; owner: number };
const taskInfo = new Map<number, TaskInfo>(); // per-tile task data (for rendering and future updates)
let dice: [number, number] = [1, 1];

// Turn state
let currentPlayer = 0; // index into tokens
// Multi-stop selection state for a turn
let selectableTiles: Set<number> = new Set(); // tiles you can click this phase (final dest + assigned tasks on path)
let segmentFromIdx: number | null = null; // starting tile for current selection segment
let remainingSteps: number = 0; // steps left to allocate this turn
let finalDestIdx: number | null = null; // current segment's final destination (from + remaining)

// Tokens
type Token = { color: string; index: number }; // index: 0- based tile position
let tokens: Token[] = [];
let balances: number[] = []; // money per player
let targetAmountToWin = 100;

// Movement animation state
type MoveAnim = {
  player: number;
  from: number; // starting tile index (0-based)
  steps: number; // positive steps forward
  start: number; // ms timestamp
  duration: number; // ms
};
let moveAnim: MoveAnim | null = null;
let isAnimating = false;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function nextTurn() {
  currentPlayer = (currentPlayer + 1) % tokens.length;
  updateTurnDot();
  if (rollLabel) rollLabel.textContent = '';
  setTossEnabled(true);
  showTossArrow(true);
  draw();
}

function handleLandingAfterAnimation(playerIdx: number, landedIdx: number, options?: { showExistingCard?: boolean }) {
  // If landed on a task tile, and it's unowned, show the task card and assign ownership
  if (taskTiles.has(landedIdx) && taskModal && taskPaysEl && taskStepsEl && taskCloseBtn) {
    const existing = taskInfo.get(landedIdx);
    if (!existing) {
      const base = Math.random();
      const stepsRaw = Math.round(1 + (1 - base) * 11 + Math.random() * 1.5);
      const paysRaw = Math.round(5 + base * 5 + Math.random() * 1.2);
      const steps = clamp(stepsRaw, 1, 12);
      const pays = clamp(paysRaw, 5, 10);
      taskInfo.set(landedIdx, { pays, steps, owner: playerIdx });
      taskPaysEl.textContent = String(pays);
      taskStepsEl.textContent = String(steps);
      taskModal.style.display = 'grid';
      const onClose = () => {
        taskModal.style.display = 'none';
        taskCloseBtn.removeEventListener('click', onClose);
        nextTurn();
      };
      taskCloseBtn.addEventListener('click', onClose);
      draw();
      return;
    } else if (options?.showExistingCard) {
      // Show info for existing task (no ownership changes)
      const pays = existing.pays;
      const steps = existing.steps;
      taskPaysEl.textContent = String(pays);
      taskStepsEl.textContent = String(steps);
      taskModal.style.display = 'grid';
      const onClose2 = () => {
        taskModal.style.display = 'none';
        taskCloseBtn.removeEventListener('click', onClose2);
        nextTurn();
      };
      taskCloseBtn.addEventListener('click', onClose2);
      draw();
      return;
    }
  }
  // Otherwise advance immediately
  nextTurn();
}

function startMoveAnimation(
  playerIdx: number,
  fromIdx: number,
  steps: number,
  options?: { showExistingCard?: boolean; onArrive?: (playerIdx: number, landedIdx: number) => void }
) {
  if (steps <= 0) {
    // No movement; just resolve landing and turn progression
    if (options?.onArrive) {
      options.onArrive(playerIdx, fromIdx);
    } else {
      handleLandingAfterAnimation(playerIdx, fromIdx, options);
    }
    return;
  }
  const duration = Math.min(1600, Math.max(350, 180 * steps));
  // Apply steal effects upfront based on the full path
  applyStealForPath(fromIdx, steps, playerIdx);
  isAnimating = true;
  moveAnim = { player: playerIdx, from: ((fromIdx % tileCount) + tileCount) % tileCount, steps, start: performance.now(), duration };
  setTossEnabled(false);
  showTossArrow(false);

  const tick = (now: number) => {
    if (!moveAnim) return;
    const t = Math.min(1, (now - moveAnim.start) / moveAnim.duration);
    // Redraw with current fractional position
    draw();
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      // Finalize
      const dest = (moveAnim.from + moveAnim.steps) % tileCount;
      tokens[playerIdx].index = dest;
      moveAnim = null;
      isAnimating = false;
      draw();
      if (options?.onArrive) {
        options.onArrive(playerIdx, dest);
      } else {
        handleLandingAfterAnimation(playerIdx, dest, options);
      }
    }
  };
  requestAnimationFrame(tick);
}

function checkForWinner() {
  for (let i = 0; i < balances.length; i++) {
    if (balances[i] >= targetAmountToWin) {
      alert(`Player ${i + 1} wins with $${balances[i]}!`);
      setTossEnabled(false);
      return true;
    }
  }
  return false;
}

function generateDistinctColors(n: number, sat = 70, light = 55): string[] {
  const colors: string[] = [];
  const offset = Math.random() * 360;
  for (let i = 0; i < n; i++) {
    const hue = (offset + (i * 360) / n) % 360;
    colors.push(`hsl(${hue} ${sat}% ${light}%)`);
  }
  return colors;
}

function createTokens(count: number): Token[] {
  const colors = generateDistinctColors(count);
  const list: Token[] = [];
  for (let i = 0; i < count; i++) list.push({ color: colors[i], index: 0 });
  return list;
}

function createBalances(count: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(0);
  return arr;
}

// When moving, if you pass or land on any players, steal all their money
function applyStealForPath(fromIdx: number, steps: number, mover: number) {
  if (steps <= 0 || tokens.length <= 1) return;
  const N = Math.max(1, tileCount);
  const norm = (v: number) => ((v % N) + N) % N;
  const start = norm(fromIdx);

// Any tiles entered along the move (including the landing tile)
  for (let s = 1; s <= steps; s++) {
    const tile = norm(start + s);
    for (let i = 0; i < tokens.length; i++) {
      if (i === mover) continue;
      const pos = norm(tokens[i].index);
      if (pos === tile) {
        const amt = balances[i] ?? 0;
        if (amt > 0) {
          balances[mover] = (balances[mover] ?? 0) + amt;
          balances[i] = 0;
        }
      }
    }
  }
  renderBalances();
  checkForWinner();
}

// Pick task tiles spread around the circle as evenly as practical
function pickTaskTiles(N: number, M: number): Set<number> {
  const result = new Set<number>();
  if (N <= 0 || M <= 0) return result;
  const max = Math.max(0, Math.min(N, Math.floor(N * 0.25))); // safeguard
  const count = Math.min(M, max);
  if (count === 0) return result;
  const step = N / count;
  let offset = Math.random() * step; // randomize starting point
  for (let i = 0; i < count; i++) {
  let idx = Math.floor(offset + i * step) % N;
  if (idx === 0) idx = 1 % N; // never choose box 1 (index 0)
    // Resolve collisions by moving forward until a free tile is found
    let tries = 0;
  while ((idx === 0 || result.has(idx)) && tries < N) {
      idx = (idx + 1) % N;
      tries++;
    }
    if (!result.has(idx)) result.add(idx);
  }
  return result;
}

// Canvas setup
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

document.body.style.margin = '0';
document.body.style.background = '#000';
document.body.style.overflow = 'hidden';
document.body.appendChild(canvas);

// UI wiring
const tossBtn = document.getElementById('tossBtn') as HTMLButtonElement | null;
const tossArrow = document.getElementById('tossArrow') as HTMLSpanElement | null;
const rollLabel = document.getElementById('rollLabel') as HTMLSpanElement | null;
const turnDot = document.getElementById('turnDot') as HTMLSpanElement | null;
const balancesRow = document.getElementById('balances') as HTMLDivElement | null;
const setupModal = document.getElementById('setup-modal') as HTMLDivElement | null;
const setupForm = document.getElementById('setup-form') as HTMLFormElement | null;
const boxesInput = document.getElementById('boxesInput') as HTMLInputElement | null;
const tasksInput = document.getElementById('tasksInput') as HTMLInputElement | null;
const playersInput = document.getElementById('playersInput') as HTMLInputElement | null;
const targetAmountInput = document.getElementById('targetAmountInput') as HTMLInputElement | null;
// Task modal elements
const taskModal = document.getElementById('task-modal') as HTMLDivElement | null;
const taskPaysEl = document.getElementById('taskPays') as HTMLSpanElement | null;
const taskStepsEl = document.getElementById('taskSteps') as HTMLSpanElement | null;
const taskCloseBtn = document.getElementById('taskCloseBtn') as HTMLButtonElement | null;
// Pay-steps modal elements
const payStepsModal = document.getElementById('pay-steps-modal') as HTMLDivElement | null;
const payStepsRange = document.getElementById('payStepsRange') as HTMLInputElement | null;
const payStepsValue = document.getElementById('payStepsValue') as HTMLSpanElement | null;
const payStepsApply = document.getElementById('payStepsApply') as HTMLButtonElement | null;
const payStepsCancel = document.getElementById('payStepsCancel') as HTMLButtonElement | null;
let payStepsTileIdx: number | null = null; // which task tile we are paying on

// Add-steps modal elements (sabotage)
const addStepsModal = document.getElementById('add-steps-modal') as HTMLDivElement | null;
const addStepsRange = document.getElementById('addStepsRange') as HTMLInputElement | null;
const addStepsValue = document.getElementById('addStepsValue') as HTMLSpanElement | null;
const addStepsApply = document.getElementById('addStepsApply') as HTMLButtonElement | null;
const addStepsCancel = document.getElementById('addStepsCancel') as HTMLButtonElement | null;
let addStepsTileIdx: number | null = null;

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

function randInt1to6(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return (arr[0] % 6) + 1;
  }
  return Math.floor(Math.random() * 6) + 1;
}

function rollTwoDice(): [number, number] {
  return [randInt1to6(), randInt1to6()];
}

function updateRollLabel() {
  if (rollLabel) rollLabel.textContent = `Steps left: ${remainingSteps}`;
}

function updateTurnDot() {
  if (!turnDot || tokens.length === 0) return;
  turnDot.style.background = tokens[currentPlayer].color;
}

function renderBalances() {
  if (!balancesRow) return;
  balancesRow.innerHTML = '';
  for (let i = 0; i < tokens.length; i++) {
    const pill = document.createElement('span');
    pill.className = 'balance-pill';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = tokens[i].color;
    const text = document.createElement('span');
    text.textContent = `$${balances[i] ?? 0}`;
    pill.appendChild(dot);
    pill.appendChild(text);
    balancesRow.appendChild(pill);
  }
}

function showTossArrow(show: boolean) {
  if (tossArrow) {
    tossArrow.classList.toggle('show', show);
  }
  // When prompting next player, always clear previous roll math
  if (show && rollLabel) rollLabel.textContent = '';
}

function setTossEnabled(enabled: boolean) {
  if (!tossBtn) return;
  tossBtn.disabled = !enabled;
}

// Utilities for multi-stop selection flow
const normIdx = (v: number, N: number = tileCount) => ((v % N) + N) % N;

function computeSelectableTiles(fromIdx: number, steps: number): { tiles: Set<number>; finalDest: number } {
  const N = Math.max(1, tileCount);
  const tiles = new Set<number>();
  const finalDest = normIdx(fromIdx + steps, N);
  // Always allow the final destination
  tiles.add(finalDest);
  // Allow stopping on assigned tasks along the path (exclude current tile and final dest already added)
  for (let d = 1; d < steps; d++) {
    const idx = normIdx(fromIdx + d, N);
    if (taskInfo.has(idx)) tiles.add(idx);
  }
  return { tiles, finalDest };
}

function beginSelection(fromIdx: number, steps: number) {
  segmentFromIdx = normIdx(fromIdx);
  remainingSteps = Math.max(0, steps);
  updateRollLabel();
  const { tiles, finalDest } = computeSelectableTiles(segmentFromIdx, remainingSteps);
  selectableTiles = tiles;
  finalDestIdx = finalDest;
  draw();
}

function clearSelection() {
  selectableTiles.clear();
  segmentFromIdx = null;
  remainingSteps = 0;
  updateRollLabel();
  finalDestIdx = null;
}

function continueSelection(fromIdx: number, steps: number) {
  beginSelection(fromIdx, steps);
}

function openPayOrSabotageModalAt(tileIdx: number, budgetSteps: number, after?: () => void) {
  const info = taskInfo.get(tileIdx);
  if (!info || budgetSteps <= 0) {
    if (after) after();
    return;
  }
  const owner = info.owner;
  const isMine = owner === currentPlayer;

  // Pay-down modal (your own task)
  if (isMine) {
    if (!(payStepsModal && payStepsRange && payStepsValue && payStepsApply && payStepsCancel)) {
      if (after) after();
      return;
    }
    const maxSelectable = clamp(Math.min(budgetSteps, info.steps), 1, 12);
    if (maxSelectable <= 0) {
      if (after) after();
      return;
    }
    payStepsRange.min = '1';
    payStepsRange.max = String(maxSelectable);
    payStepsRange.value = '1';
    payStepsValue.textContent = '1';
    payStepsTileIdx = tileIdx;
    payStepsModal.style.display = 'grid';

    const onInput = () => { if (payStepsValue && payStepsRange) payStepsValue.textContent = payStepsRange.value; };
    payStepsRange.addEventListener('input', onInput);

    const cleanup = () => {
      payStepsModal.style.display = 'none';
      payStepsRange.removeEventListener('input', onInput);
      payStepsTileIdx = null;
    };

    const onCancel = () => {
  updateRollLabel();
  cleanup();
      if (after) after();
    };
    const onApply = () => {
      const useSteps = clamp(parseInt(payStepsRange.value || '1', 10) || 1, 1, maxSelectable);
      // Deduct from task steps
      const t = taskInfo.get(tileIdx);
      if (t) {
        const newSteps = Math.max(0, t.steps - useSteps);
        if (newSteps <= 0) {
          // Task completed: remove and pay owner
          taskInfo.delete(tileIdx);
          balances[currentPlayer] = (balances[currentPlayer] ?? 0) + t.pays;
          renderBalances();
          checkForWinner();
        } else {
          taskInfo.set(tileIdx, { ...t, steps: newSteps });
        }
      }
      remainingSteps = Math.max(0, budgetSteps - useSteps);
      cleanup();
      if (after) after();
    };

    payStepsCancel.onclick = onCancel;
    payStepsApply.onclick = onApply;
    return;
  }

  // Sabotage modal (opponent's task)
  if (!(addStepsModal && addStepsRange && addStepsValue && addStepsApply && addStepsCancel)) {
    if (after) after();
    return;
  }
  const maxAdd = clamp(Math.max(1, budgetSteps), 1, 12);
  addStepsRange.min = '1';
  addStepsRange.max = String(maxAdd);
  addStepsRange.value = '1';
  addStepsValue.textContent = '1';
  addStepsTileIdx = tileIdx;
  addStepsModal.style.display = 'grid';
  const onInputAdd = () => { if (addStepsValue && addStepsRange) addStepsValue.textContent = addStepsRange.value; };
  addStepsRange.addEventListener('input', onInputAdd);
  const cleanupAdd = () => {
    addStepsModal.style.display = 'none';
    addStepsRange.removeEventListener('input', onInputAdd);
    addStepsTileIdx = null;
  };
  const onCancelAdd = () => {
    cleanupAdd();
    if (after) after();
  };
  const onApplyAdd = () => {
    const addSteps = clamp(parseInt(addStepsRange.value || '1', 10) || 1, 1, maxAdd);
    const t = taskInfo.get(tileIdx);
    if (t) taskInfo.set(tileIdx, { ...t, steps: clamp(t.steps + addSteps, 0, 999) });
  remainingSteps = Math.max(0, budgetSteps - addSteps);
  updateRollLabel();
    cleanupAdd();
    if (after) after();
  };
  addStepsCancel.onclick = onCancelAdd;
  addStepsApply.onclick = onApplyAdd;
}

if (tossBtn) {
  tossBtn.addEventListener('click', () => {
    if (tokens.length === 0 || tossBtn.disabled) return;
    // Hide arrow and disable toss for this player until move is confirmed
  showTossArrow(false);
  if (rollLabel) rollLabel.textContent = '';
    setTossEnabled(false);

    dice = rollTwoDice();
    updateRollLabel();

    // Compute target tile for current player
  const steps = dice[0] + dice[1];
  const from = tokens[currentPlayer].index; // 0-based
  beginSelection(from, steps);
  });
}

// Setup modal logic
if (setupForm && setupModal && boxesInput && playersInput && tasksInput) {
  setTossEnabled(false);
  showTossArrow(false);

  // Keep tasks max aligned with 25% of boxes
  function updateTasksMax() {
  if (!boxesInput || !tasksInput) return;
  const boxes = clamp(parseInt(boxesInput.value || '20', 10) || 20, Number(boxesInput.min), Number(boxesInput.max));
  const maxTasks = Math.floor(boxes * 0.25);
  tasksInput.max = String(maxTasks);
  // Adjust value if it exceeds new max
  const current = parseInt(tasksInput.value || '0', 10) || 0;
  if (current > maxTasks) tasksInput.value = String(maxTasks);
  }
  boxesInput.addEventListener('input', updateTasksMax);
  updateTasksMax();

  setupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const boxes = clamp(parseInt(boxesInput.value || '20', 10) || 20, Number(boxesInput.min), Number(boxesInput.max));
    const p = clamp(parseInt(playersInput.value || '2', 10) || 2, Number(playersInput.min), Number(playersInput.max));
    const maxTasks = Math.floor(boxes * 0.25);
    const tRaw = parseInt(tasksInput.value || '0', 10) || 0;
    const t = clamp(tRaw, 0, maxTasks);
    const targetAmount = targetAmountInput ? clamp(parseInt(targetAmountInput.value || '100', 10) || 100, Number(targetAmountInput.min), 1000000) : 100;

    tileCount = boxes;
    players = p;
    taskCount = t;
    taskInfo.clear();
    tokens = createTokens(players); // everyone starts at tile index 0 (box 1)
    balances = createBalances(players);
  currentPlayer = 0;
  clearSelection();
    dice = [1, 1];
    // Pick task tiles spread around the board
    taskTiles = pickTaskTiles(tileCount, taskCount);
    // Store target amount to win
  targetAmountToWin = targetAmount;
    // No previous roll shown before the first toss
    if (rollLabel) rollLabel.textContent = '';
    updateTurnDot();
    renderBalances();

    // Hide modal and enable controls
    setupModal.style.display = 'none';
    setTossEnabled(true);
    showTossArrow(true); // prompt first player to toss; arrow sits in the roll label spot

    draw();
  });
}

// Resize and render
function resize() {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

window.addEventListener('resize', resize);

function drawRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  if (!ctx) return;
  const rr = Math.min(r, w / 2, h / 2);
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
}

function drawDie(cx: number, cy: number, size: number, value: number) {
  if (!ctx) return;
  const half = size / 2;
  const x = cx - half;
  const y = cy - half;
  // Body
  drawRoundedRect(x, y, size, size, Math.max(6, size * 0.15));
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = size * 0.08;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.stroke();

  // Pips
  const pipR = Math.max(2, size * 0.08);
  const off = size * 0.28; // offset from center to each grid position
  const positions: Record<number, Array<[number, number]>> = {
    1: [[0, 0]],
    2: [[-off, -off], [off, off]],
    3: [[-off, -off], [0, 0], [off, off]],
    4: [[-off, -off], [off, -off], [-off, off], [off, off]],
    5: [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]],
    6: [[-off, -off], [off, -off], [-off, 0], [off, 0], [-off, off], [off, off]],
  };
  ctx.fillStyle = '#111';
  for (const [dx, dy] of positions[value] || []) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, pipR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTokens(cx: number, cy: number, innerRadius: number, outerRadius: number, N: number) {
  if (!ctx) return;
  const thickness = outerRadius - innerRadius;
  const tokenR = Math.max(4, Math.min(thickness * 0.28, Math.min(window.innerWidth, window.innerHeight) * 0.02));
  const groupByTile = new Map<number, Token[]>();
  // If animating, skip grouping the moving token; will draw it separately at fractional position
  const movingIndex = moveAnim ? moveAnim.player : -1;
  for (let pi = 0; pi < tokens.length; pi++) {
    if (pi === movingIndex) continue;
    const t = tokens[pi];
    const posIdx = ((t.index % N) + N) % N; // normalize
    const arr = groupByTile.get(posIdx) || [];
    arr.push(t);
    groupByTile.set(posIdx, arr);
  }

  const step = (Math.PI * 2) / N;
  const midR = innerRadius + thickness * 0.62; // place slightly closer to outer edge

  for (const [tileIdx, arr] of groupByTile) {
    const a0 = tileIdx * step;
    const a1 = (tileIdx + 1) * step;
    const am = (a0 + a1) / 2;
    const baseX = cx + Math.cos(am) * midR;
    const baseY = cy + Math.sin(am) * midR;

    // Arrange tokens in a small circle around the tile center point
    const ringR = tokenR * (arr.length > 1 ? 2.2 : 0);
    for (let i = 0; i < arr.length; i++) {
      const ang = arr.length > 1 ? (i / arr.length) * Math.PI * 2 : 0;
      const px = baseX + Math.cos(ang) * ringR;
      const py = baseY + Math.sin(ang) * ringR;
      const isCurrent = arr[i] === tokens[currentPlayer];

      // Glow for current player's token (underlay)
      if (isCurrent) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, tokenR * 1.3, 0, Math.PI * 2);
        ctx.fillStyle = tokens[currentPlayer].color;
        ctx.globalAlpha = 0.22; // slightly stronger
        ctx.shadowColor = tokens[currentPlayer].color;
        ctx.shadowBlur = tokenR * 0.8; // subtle increase
        ctx.fill();
        ctx.restore();
      }

      // Draw token
      ctx.beginPath();
      ctx.arc(px, py, tokenR, 0, Math.PI * 2);
      ctx.fillStyle = arr[i].color;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = tokenR * 0.6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
    }
  }

  // Draw the moving token (if any) at its fractional position along the track
  if (moveAnim) {
    const pNow = Math.min(1, (performance.now() - moveAnim.start) / moveAnim.duration);
    const p = easeInOutCubic(pNow);
    const fracIndex = (moveAnim.from + p * moveAnim.steps) % N;
    const angle = (fracIndex + 0.5) * step; // center of (possibly fractional) tile
    const px = cx + Math.cos(angle) * midR;
    const py = cy + Math.sin(angle) * midR;
    const token = tokens[moveAnim.player];

    // Subtle motion trail glow
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, tokenR * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = token.color;
    ctx.globalAlpha = 0.22;
    ctx.shadowColor = token.color;
    ctx.shadowBlur = tokenR * 0.9;
    ctx.fill();
    ctx.restore();

    // Token body
    ctx.beginPath();
    ctx.arc(px, py, tokenR, 0, Math.PI * 2);
    ctx.fillStyle = token.color;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = tokenR * 0.6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }
}

function drawHighlight(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  N: number,
  tileIdx: number | null,
  fill: string = 'rgba(255, 215, 0, 0.22)',
  stroke: string = 'rgba(255, 215, 0, 0.6)'
) {
  if (!ctx || tileIdx == null) return;
  const step = (Math.PI * 2) / N;
  const a0 = tileIdx * step;
  const a1 = (tileIdx + 1) * step;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a0) * innerRadius, cy + Math.sin(a0) * innerRadius);
  ctx.lineTo(cx + Math.cos(a0) * outerRadius, cy + Math.sin(a0) * outerRadius);
  ctx.arc(cx, cy, outerRadius, a0, a1);
  ctx.lineTo(cx + Math.cos(a1) * innerRadius, cy + Math.sin(a1) * innerRadius);
  ctx.arc(cx, cy, innerRadius, a1, a0, true);
  ctx.closePath();
  ctx.fillStyle = fill; // customizable glow
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

function draw() {
  if (!ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Update hover cursor based on whether a tile is selectable
  if (selectableTiles.size > 0) {
    canvas.classList.add('canvas-pointer');
  } else {
    canvas.classList.remove('canvas-pointer');
  }

  // Clear to black
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // Board parameters
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.38; // leave margin for UI
  const innerRadius = radius * 0.78;     // thickness of the track

  // Draw circular path as segmented ring of tiles
  const N = Math.max(3, Math.floor(tileCount));
  const twoPi = Math.PI * 2;
  const step = twoPi / N;

  // Base ring background (subtle)
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, twoPi);
  ctx.arc(cx, cy, innerRadius, twoPi, 0, true);
  ctx.closePath();
  ctx.fillStyle = '#111';
  ctx.fill();

  // Tiles
  for (let i = 0; i < N; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;

    // Create a tile segment (wedge between two radii, with inner and outer arcs)
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * innerRadius, cy + Math.sin(a0) * innerRadius);
    ctx.lineTo(cx + Math.cos(a0) * radius,      cy + Math.sin(a0) * radius);
    ctx.arc(cx, cy, radius, a0, a1);
    ctx.lineTo(cx + Math.cos(a1) * innerRadius, cy + Math.sin(a1) * innerRadius);
    ctx.arc(cx, cy, innerRadius, a1, a0, true);
    ctx.closePath();

    // Alternate colors for readability; overlay task highlight if needed
    const even = i % 2 === 0;
    const baseColor = even ? '#2b2b2b' : '#1c1c1c';
    ctx.fillStyle = baseColor;
    ctx.fill();

    // Task background overlay (light red)
    if (taskTiles.has(i)) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255, 99, 99, 0.28)';
      ctx.fill();
      ctx.restore();
    }

    // Tile border
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Optional index marker
    const mid = (a0 + a1) / 2;
    const labelR = (innerRadius + radius) / 2;
    ctx.fillStyle = '#bbb';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * labelR, cy + Math.sin(mid) * labelR);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillText(String(i + 1), 0, 0);
    // Add TASK label beneath number when applicable
    if (taskTiles.has(i)) {
      ctx.fillStyle = 'rgba(255,160,160,0.95)';
      ctx.font = '10px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.translate(0, 12);
      ctx.fillText('TASK', 0, 0);
    }
    ctx.restore();

    // If this tile has task info, draw pays/steps inside a small translucent box near the outside edge
    if (taskTiles.has(i)) {
      const info = taskInfo.get(i);
      if (info) {
        const mid = (a0 + a1) / 2;
        const outR = radius + 24; // push a bit further out from the ring
        const tx = cx + Math.cos(mid) * outR;
        const ty = cy + Math.sin(mid) * outR;
        const paysText = `P: ${info.pays}`;
        const stepsText = `S: ${info.steps}`;

        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';

        // Measure to size the box
        const paysW = ctx.measureText(paysText).width;
        const stepsW = ctx.measureText(stepsText).width;
        const contentW = Math.max(paysW, stepsW);
        const padX = 8;
        const padY = 6;
        const lineH = 12;
        const gap = 2;
        const dotSpace = 14; // space on right for owner dot
        const boxW = Math.ceil(padX * 2 + contentW + dotSpace);
        const boxH = Math.ceil(padY * 2 + lineH * 2 + gap);
        const x = tx - boxW / 2;
        const y = ty - boxH / 2;

        // Background box
        drawRoundedRect(x, y, boxW, boxH, 8);
        ctx.fillStyle = 'rgba(22,22,22,0.7)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.stroke();

        // Text inside
        const textX = x + padX;
        const pY = y + padY + lineH / 2;
        const sY = y + padY + lineH + gap + lineH / 2;
        ctx.fillStyle = '#34d399';
        ctx.fillText(paysText, textX, pY);
        ctx.fillStyle = '#f87171';
        ctx.fillText(stepsText, textX, sY);

        // Owner color dot inside box on the right
        const ownerColor = tokens[info.owner]?.color;
        if (ownerColor) {
          const dotCx = x + boxW - padX - 5;
          const dotCy = y + boxH / 2;
          ctx.beginPath();
          ctx.arc(dotCx, dotCy, 4, 0, Math.PI * 2);
          ctx.fillStyle = ownerColor;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // When it's your turn, and you've rolled (selectableTile set), and you're on your own task,
  // also highlight your current tile to signal you can use steps on the task instead of moving.
  if (selectableTiles.size > 0 && tokens.length > 0) {
    const fromIdx = ((tokens[currentPlayer].index % N) + N) % N;
    const owner = taskInfo.get(fromIdx)?.owner;
    const onOwnedTask = owner === currentPlayer;
    if (onOwnedTask) {
      // Blue highlight for current tile
      drawHighlight(
        cx, cy, innerRadius, radius, N, fromIdx,
        'rgba(59, 130, 246, 0.22)', // blue fill
        'rgba(59, 130, 246, 0.6)'
      );
    } else if (owner != null && owner !== currentPlayer) {
      // Different color highlight (purple) when you can add steps to someone else's task
      drawHighlight(
        cx, cy, innerRadius, radius, N, fromIdx,
        'rgba(168, 85, 247, 0.22)', // purple fill
        'rgba(168, 85, 247, 0.6)'
      );
    }
  }

  // Highlight selectable tiles (after toss) in gold
  if (selectableTiles.size > 0) {
    for (const ti of selectableTiles) {
      drawHighlight(cx, cy, innerRadius, radius, N, ti);
    }
  }

  // Tokens on board
  drawTokens(cx, cy, innerRadius, radius, N);

  // Dice in the middle
  const dieSize = Math.min(w, h) * 0.1;
  const gap = dieSize * 0.2;
  drawDie(cx - (dieSize / 2 + gap / 2), cy, dieSize, dice[0]);
  drawDie(cx + (dieSize / 2 + gap / 2), cy, dieSize, dice[1]);
}

// Handle canvas clicks to move to highlighted tile when applicable
canvas.addEventListener('click', (ev) => {
  if (isAnimating) return;
  if (tokens.length === 0) return;
  const inSelection = selectableTiles.size > 0 && remainingSteps > 0 && segmentFromIdx != null;
  if (!inSelection) return;
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.38;
  const innerRadius = radius * 0.78;

  // Check if point is in the highlighted wedge
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r < innerRadius || r > radius) return; // not in ring

  let ang = Math.atan2(dy, dx);
  if (ang < 0) ang += Math.PI * 2;

  const N = tileCount;
  const tileIdx = Math.floor((ang / (Math.PI * 2)) * N);
  // If the player is on a task and clicked their current tile, open the appropriate modal using remainingSteps budget.
  const currentIdx = tokens[currentPlayer].index % N;
  const info = taskInfo.get(currentIdx);
  const canPayOnTask = info && info.owner === currentPlayer;
  const canAddToOthersTask = info && info.owner != null && info.owner !== currentPlayer;
  if (tileIdx === currentIdx && (canPayOnTask || canAddToOthersTask)) {
    // Spend from budget on current tile, then continue selection or end
    openPayOrSabotageModalAt(currentIdx, remainingSteps, () => {
      if (remainingSteps > 0) {
        continueSelection(currentIdx, remainingSteps);
      } else {
        clearSelection();
        nextTurn();
      }
    });
    return;
  }

  if (!selectableTiles.has(tileIdx)) return; // clicked a non-selectable tile

  // Determine movement distance within current segment
  const fromIdxForMove = normIdx(segmentFromIdx!, N);
  const dist = normIdx(tileIdx - fromIdxForMove, N); // distance forward

  // If clicked final destination, consume all remaining and end turn after landing normally
  if (finalDestIdx != null && tileIdx === finalDestIdx) {
    const steps = remainingSteps;
    clearSelection();
    startMoveAnimation(currentPlayer, fromIdxForMove, steps);
    return;
  }

  // Otherwise, it's an assigned task along the path; move there, then open modal to spend from remaining budget
  const budgetAfterLanding = Math.max(0, remainingSteps - dist);
  // Start animation; after arrival, set new state and open modal
  startMoveAnimation(currentPlayer, fromIdxForMove, dist, {
    onArrive: (_player, dest) => {
      // Set new segment start and remaining
      segmentFromIdx = dest;
  remainingSteps = budgetAfterLanding;
  updateRollLabel();
      // Open modal for pay/sabotage; after closing, either continue selection or end
      openPayOrSabotageModalAt(dest, remainingSteps, () => {
        if (remainingSteps > 0) {
          continueSelection(dest, remainingSteps);
        } else {
          clearSelection();
          nextTurn();
        }
      });
    },
  });
});

// Init
// Start with no previous roll shown
if (rollLabel) rollLabel.textContent = '';
updateTurnDot();
resize();