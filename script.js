(() => {
  "use strict";

  const SIZE = 9;
  const BOX = 3;

  const DIFFICULTY_CLUES = {
    easy: 40,
    medium: 32,
    hard: 26,
    expert: 22,
  };

  const state = {
    solution: null,     // 81-length array, the fully solved board
    puzzle: null,        // 81-length array, 0 = empty, as originally dealt
    board: null,         // 81-length array, current values (0 = empty)
    notes: null,          // 81-length array of Sets
    given: null,          // 81-length array of booleans
    selected: null,       // index 0-80 or null
    mistakes: 0,
    maxMistakes: 3,
    notesMode: false,
    timerId: null,
    seconds: 0,
    history: [],          // stack of {index, prevValue, prevNotes}
    gameOver: false,
  };

  const boardEl = document.getElementById("board");
  const timerEl = document.getElementById("timer");
  const mistakesEl = document.getElementById("mistakes");
  const difficultyEl = document.getElementById("difficulty");
  const newGameBtn = document.getElementById("new-game");
  const winNewGameBtn = document.getElementById("win-new-game");
  const winOverlay = document.getElementById("win-overlay");
  const winMessage = document.getElementById("win-message");
  const undoBtn = document.getElementById("undo");
  const notesToggleBtn = document.getElementById("notes-toggle");
  const hintBtn = document.getElementById("hint");
  const checkBtn = document.getElementById("check");
  const solveBtn = document.getElementById("solve");
  const numpad = document.getElementById("numpad");

  // ---------- Sudoku generation & solving ----------

  function rowOf(i) { return Math.floor(i / SIZE); }
  function colOf(i) { return i % SIZE; }
  function boxOf(i) {
    const r = rowOf(i), c = colOf(i);
    return Math.floor(r / BOX) * BOX + Math.floor(c / BOX);
  }

  function peersOf(i) {
    const r = rowOf(i), c = colOf(i);
    const boxRow = Math.floor(r / BOX) * BOX;
    const boxCol = Math.floor(c / BOX) * BOX;
    const peers = new Set();
    for (let k = 0; k < SIZE; k++) {
      peers.add(r * SIZE + k);
      peers.add(k * SIZE + c);
    }
    for (let dr = 0; dr < BOX; dr++) {
      for (let dc = 0; dc < BOX; dc++) {
        peers.add((boxRow + dr) * SIZE + (boxCol + dc));
      }
    }
    peers.delete(i);
    return peers;
  }

  const PEERS = Array.from({ length: 81 }, (_, i) => peersOf(i));

  function isSafe(board, index, value) {
    for (const p of PEERS[index]) {
      if (board[p] === value) return false;
    }
    return true;
  }

  function shuffledDigits() {
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = digits.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [digits[i], digits[j]] = [digits[j], digits[i]];
    }
    return digits;
  }

  // Fills the board completely using randomized backtracking.
  function fillBoard(board) {
    const emptyIndex = board.indexOf(0);
    if (emptyIndex === -1) return true;
    for (const d of shuffledDigits()) {
      if (isSafe(board, emptyIndex, d)) {
        board[emptyIndex] = d;
        if (fillBoard(board)) return true;
        board[emptyIndex] = 0;
      }
    }
    return false;
  }

  // Counts solutions up to `limit` using plain backtracking (for uniqueness checks).
  function countSolutions(board, limit) {
    const emptyIndex = board.indexOf(0);
    if (emptyIndex === -1) return 1;
    let count = 0;
    for (let d = 1; d <= 9; d++) {
      if (isSafe(board, emptyIndex, d)) {
        board[emptyIndex] = d;
        count += countSolutions(board, limit - count);
        board[emptyIndex] = 0;
        if (count >= limit) break;
      }
    }
    return count;
  }

  function solveBoard(board) {
    const copy = board.slice();
    if (solveHelper(copy)) return copy;
    return null;
  }

  function solveHelper(board) {
    const emptyIndex = board.indexOf(0);
    if (emptyIndex === -1) return true;
    for (let d = 1; d <= 9; d++) {
      if (isSafe(board, emptyIndex, d)) {
        board[emptyIndex] = d;
        if (solveHelper(board)) return true;
        board[emptyIndex] = 0;
      }
    }
    return false;
  }

  function generatePuzzle(clueCount) {
    const solution = new Array(81).fill(0);
    fillBoard(solution);

    const puzzle = solution.slice();
    const cellOrder = Array.from({ length: 81 }, (_, i) => i);
    for (let i = cellOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cellOrder[i], cellOrder[j]] = [cellOrder[j], cellOrder[i]];
    }

    let clues = 81;
    for (const index of cellOrder) {
      if (clues <= clueCount) break;
      const backup = puzzle[index];
      puzzle[index] = 0;

      const testBoard = puzzle.slice();
      const solutions = countSolutions(testBoard, 2);
      if (solutions !== 1) {
        puzzle[index] = backup;
      } else {
        clues--;
      }
    }

    return { puzzle, solution };
  }

  // ---------- Game state management ----------

  function newGame() {
    stopTimer();
    const difficulty = difficultyEl.value;
    const clueCount = DIFFICULTY_CLUES[difficulty] ?? 32;
    const { puzzle, solution } = generatePuzzle(clueCount);

    state.solution = solution;
    state.puzzle = puzzle;
    state.board = puzzle.slice();
    state.notes = Array.from({ length: 81 }, () => new Set());
    state.given = puzzle.map((v) => v !== 0);
    state.selected = null;
    state.mistakes = 0;
    state.notesMode = false;
    state.seconds = 0;
    state.history = [];
    state.gameOver = false;

    notesToggleBtn.textContent = "✏️ Notes: Off";
    notesToggleBtn.classList.remove("active");
    mistakesEl.textContent = `0/${state.maxMistakes}`;
    mistakesEl.classList.remove("error");
    winOverlay.classList.add("hidden");

    renderBoard();
    startTimer();
  }

  function startTimer() {
    updateTimerDisplay();
    state.timerId = setInterval(() => {
      state.seconds++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function updateTimerDisplay() {
    const m = Math.floor(state.seconds / 60).toString().padStart(2, "0");
    const s = (state.seconds % 60).toString().padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }

  // ---------- Rendering ----------

  function renderBoard() {
    boardEl.innerHTML = "";
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = String(i);

      const c = colOf(i);
      const r = rowOf(i);
      if ((c + 1) % BOX === 0 && c !== 8) cell.classList.add("thick-right");
      if ((r + 1) % BOX === 0 && r !== 8) cell.classList.add("thick-bottom");

      if (state.given[i]) cell.classList.add("given");

      cell.addEventListener("click", () => selectCell(i));
      boardEl.appendChild(cell);
    }
    refreshBoard();
  }

  function refreshBoard() {
    const cells = boardEl.children;
    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const value = state.board[i];

      cell.classList.remove("selected", "peer", "same-value", "error");
      cell.innerHTML = "";

      if (value !== 0) {
        cell.textContent = String(value);
      } else if (state.notes[i].size > 0) {
        const grid = document.createElement("div");
        grid.className = "notes-grid";
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement("span");
          span.textContent = state.notes[i].has(n) ? String(n) : "";
          grid.appendChild(span);
        }
        cell.appendChild(grid);
      }
    }

    if (state.selected !== null) {
      const sel = state.selected;
      const selValue = state.board[sel];
      cells[sel].classList.add("selected");
      for (const p of PEERS[sel]) {
        cells[p].classList.add("peer");
      }
      if (selValue !== 0) {
        for (let i = 0; i < 81; i++) {
          if (state.board[i] === selValue) cells[i].classList.add("same-value");
        }
      }
    }

    for (let i = 0; i < 81; i++) {
      const value = state.board[i];
      if (value !== 0 && value !== state.solution[i]) {
        cells[i].classList.add("error");
      }
    }
  }

  function selectCell(index) {
    if (state.gameOver) return;
    state.selected = index;
    refreshBoard();
  }

  // ---------- Input handling ----------

  function pushHistory(index) {
    state.history.push({
      index,
      prevValue: state.board[index],
      prevNotes: new Set(state.notes[index]),
    });
  }

  function setValue(index, value) {
    if (state.given[index] || state.gameOver) return;

    if (state.notesMode) {
      if (value === 0) return;
      pushHistory(index);
      if (state.board[index] !== 0) return;
      const notes = state.notes[index];
      if (notes.has(value)) notes.delete(value);
      else notes.add(value);
      refreshBoard();
      return;
    }

    pushHistory(index);
    state.notes[index].clear();

    if (value === 0) {
      state.board[index] = 0;
      refreshBoard();
      return;
    }

    state.board[index] = value;

    if (value !== state.solution[index]) {
      state.mistakes++;
      mistakesEl.textContent = `${state.mistakes}/${state.maxMistakes}`;
      if (state.mistakes >= state.maxMistakes) {
        mistakesEl.classList.add("error");
        refreshBoard();
        endGame(false);
        return;
      }
    }

    refreshBoard();
    checkWin();
  }

  function undo() {
    const entry = state.history.pop();
    if (!entry) return;
    state.board[entry.index] = entry.prevValue;
    state.notes[entry.index] = entry.prevNotes;
    refreshBoard();
  }

  function toggleNotesMode() {
    state.notesMode = !state.notesMode;
    notesToggleBtn.textContent = state.notesMode ? "✏️ Notes: On" : "✏️ Notes: Off";
    notesToggleBtn.classList.toggle("active", state.notesMode);
  }

  function giveHint() {
    if (state.gameOver) return;
    let index = state.selected;
    if (index === null || state.board[index] === state.solution[index]) {
      const candidates = [];
      for (let i = 0; i < 81; i++) {
        if (state.board[i] !== state.solution[i]) candidates.push(i);
      }
      if (candidates.length === 0) return;
      index = candidates[Math.floor(Math.random() * candidates.length)];
    }
    pushHistory(index);
    state.notes[index].clear();
    state.board[index] = state.solution[index];
    state.selected = index;
    refreshBoard();
    boardEl.children[index].classList.add("hint-reveal");
    checkWin();
  }

  function checkForErrors() {
    refreshBoard();
  }

  function revealSolution() {
    state.board = state.solution.slice();
    state.notes = Array.from({ length: 81 }, () => new Set());
    refreshBoard();
    endGame(false, "Here's the solution.");
  }

  function checkWin() {
    for (let i = 0; i < 81; i++) {
      if (state.board[i] !== state.solution[i]) return;
    }
    endGame(true);
  }

  function endGame(won, customMessage) {
    state.gameOver = true;
    stopTimer();
    if (won) {
      winMessage.textContent = `Solved in ${timerEl.textContent} with ${state.mistakes} mistake(s).`;
    } else {
      winMessage.textContent = customMessage || "Out of mistakes. Better luck next time!";
    }
    document.querySelector("#win-overlay h2").textContent = won ? "Solved!" : "Game Over";
    winOverlay.classList.remove("hidden");
  }

  // ---------- Event wiring ----------

  newGameBtn.addEventListener("click", newGame);
  winNewGameBtn.addEventListener("click", newGame);
  difficultyEl.addEventListener("change", newGame);
  undoBtn.addEventListener("click", undo);
  notesToggleBtn.addEventListener("click", toggleNotesMode);
  hintBtn.addEventListener("click", giveHint);
  checkBtn.addEventListener("click", checkForErrors);
  solveBtn.addEventListener("click", revealSolution);

  numpad.addEventListener("click", (e) => {
    const btn = e.target.closest(".num-btn");
    if (!btn || state.selected === null) return;
    const num = parseInt(btn.dataset.num, 10);
    setValue(state.selected, num);
  });

  document.addEventListener("keydown", (e) => {
    if (state.selected === null) return;
    if (e.key >= "1" && e.key <= "9") {
      setValue(state.selected, parseInt(e.key, 10));
    } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
      setValue(state.selected, 0);
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const r = rowOf(state.selected);
      const c = colOf(state.selected);
      let nr = r, nc = c;
      if (e.key === "ArrowUp") nr = Math.max(0, r - 1);
      if (e.key === "ArrowDown") nr = Math.min(8, r + 1);
      if (e.key === "ArrowLeft") nc = Math.max(0, c - 1);
      if (e.key === "ArrowRight") nc = Math.min(8, c + 1);
      selectCell(nr * SIZE + nc);
    }
  });

  newGame();
})();
