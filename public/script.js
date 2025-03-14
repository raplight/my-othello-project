// オセロゲームのメインロジック
const boardSize = 8;
let board = [];
let playerColor = null;
let currentPlayer = 'black';
let networkRoomId = null;
let username = null;
let gameOver = false; // ゲーム終了フラグ
let matchRequested = false; // マッチングボタンが押されたか

// ユーザー名の入力。キャンセルの場合は "Guest" とする
username = prompt("ユーザー名を入力してください", "Player");
if (!username) username = "Guest";

// WebSocket の接続先URLを、プロトコルに応じて動的に設定
const wsServerUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host;
const ws = new WebSocket(wsServerUrl);

// HTML要素の取得
const lobbyDiv = document.getElementById('lobby');
const lobbyPlayersUl = document.getElementById('lobbyPlayers');
const autoMatchBtn = document.getElementById('autoMatchBtn');
const matchStatusDiv = document.getElementById('matchStatus');
const gameContainer = document.getElementById('gameContainer');
const gameDiv = document.getElementById('game');
const statusDiv = document.getElementById('status');
const resetButton = document.getElementById('reset');

// テーマ切替スイッチの初期設定
const themeToggle = document.getElementById('themeToggle');
// オートモード切替用トグルの初期設定（各クライアントで独自に管理）
const aiToggle = document.getElementById('aiToggle');
let aiAutoMode = localStorage.getItem('aiAutoMode') === 'true' ? true : false;
aiToggle.checked = aiAutoMode;

// 前回のテーマ設定の反映
if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark');
  themeToggle.checked = true;
}

// テーマ切替のイベントリスナー
themeToggle.addEventListener('change', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// マッチングボタンのクリック処理（複数クライアントが押す必要がある）
autoMatchBtn.addEventListener('click', () => {
  if (matchRequested) return;
  matchRequested = true;
  autoMatchBtn.disabled = true;
  matchStatusDiv.textContent = "マッチング待機中...";
  // サーバへマッチングリクエストを送信
  ws.send(JSON.stringify({ type: "matchRequest", username: username }));
});

// オートモード切替のイベントリスナー
aiToggle.addEventListener('change', () => {
  aiAutoMode = aiToggle.checked;
  localStorage.setItem('aiAutoMode', aiAutoMode);
  console.log("オートモードが" + (aiAutoMode ? "有効" : "無効") + "になりました");
  if (!aiAutoMode && autoMoveTimeout) {
    clearTimeout(autoMoveTimeout);
    autoMoveTimeout = null;
  }
  // 自分のターンの場合、オートモード切替後に自動で手を打つ
  if (aiAutoMode && currentPlayer === playerColor) {
    if (autoMoveTimeout) {
      clearTimeout(autoMoveTimeout);
      autoMoveTimeout = null;
    }
    autoMakeMove();
  }
});

// WebSocket の接続イベント
ws.onopen = () => {
  console.log("WebSocket接続が確立されました");
  ws.send(JSON.stringify({ type: "setUsername", username: username }));
};

// WebSocket のメッセージ受信処理
ws.onmessage = (e) => {
  let msg;
  try {
    msg = JSON.parse(e.data);
  } catch (err) {
    console.error("メッセージのパースに失敗:", err);
    return;
  }
  console.log("受信メッセージ:", msg);
  if (msg.type === "lobbyList") {
    lobbyPlayersUl.innerHTML = "";
    msg.lobby.forEach(player => {
      const li = document.createElement("li");
      li.textContent = player.name;
      lobbyPlayersUl.appendChild(li);
    });
  } else if (msg.type === "waiting") {
    matchStatusDiv.textContent = msg.message;
  } else if (msg.type === "matched") {
    // マッチング成立：対戦相手が見つかった場合の処理
    networkRoomId = msg.room;
    playerColor = msg.color;
    matchStatusDiv.textContent = "対戦相手が見つかりました！相手：" + msg.opponent + "（あなたは " + playerColor + "）";
    console.log("matched:", "playerColor =", playerColor, "currentPlayer =", currentPlayer);
    setTimeout(() => {
      lobbyDiv.style.display = 'none';
      startGame();
    }, 2000);
  } else if (msg.type === "turnUpdate") {
    currentPlayer = msg.currentTurn;
    updateStatus();
    renderBoard();
    console.log("turnUpdate:", "currentPlayer =", currentPlayer);
  } else if (msg.type === "opponentLeft") {
    alert(msg.message);
    location.reload();
  } else if (msg.type === "move" || msg.type === "pass") {
    if (msg.type === "move") {
      makeMove(msg.x, msg.y, getOpponentColor(playerColor));
    }
  }
};

ws.onerror = (e) => {
  console.error("WebSocketエラー", e);
};

ws.onclose = () => {
  console.log("WebSocket接続が閉じられました");
};

// 盤面初期化
function initBoard() {
  board = [];
  for (let y = 0; y < boardSize; y++) {
    board[y] = [];
    for (let x = 0; x < boardSize; x++) {
      board[y][x] = null;
    }
  }
  // 初期配置：中央4マス
  board[3][3] = 'white';
  board[3][4] = 'black';
  board[4][3] = 'black';
  board[4][4] = 'white';
}

// 盤面の描画
function renderBoard() {
  gameDiv.innerHTML = '';
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      // 有効な手の場合、ハイライト表示
      if (isValidMove(x, y, currentPlayer)) {
        if (currentPlayer === playerColor) {
          cell.classList.add('valid-move');
        } else {
          cell.classList.add('valid-move-opponent');
        }
      }
      if (board[y][x]) {
        const piece = document.createElement('div');
        piece.className = 'piece ' + (board[y][x] === 'black' ? 'black' : 'white');
        cell.appendChild(piece);
      }
      // オートモードが無効の場合のみ手動クリックで操作可能
      if (currentPlayer === playerColor && !aiAutoMode) {
        cell.addEventListener('click', onCellClick);
      }
      gameDiv.appendChild(cell);
    }
  }
  updateStatus();
  if (currentPlayer === playerColor) {
    checkForPassOrGameOver();
  }
  
  // 現在のターンに合わせて枠色を変更
  gameContainer.classList.remove('your-turn', 'opponent-turn');
  if (currentPlayer === playerColor) {
    gameContainer.classList.add('your-turn');
  } else {
    gameContainer.classList.add('opponent-turn');
  }
  
  // オートモードが有効かつ自分のターンの場合、自動手番を開始
  if (currentPlayer === playerColor && aiAutoMode && !gameOver) {
    if (autoMoveTimeout === null) {
      autoMoveTimeout = setTimeout(autoMakeMove, 1000);
    }
  }
}

// セルクリック時の処理（手動操作）
function onCellClick(e) {
  if (aiAutoMode) return; // オートモードの場合は無視
  const cell = e.currentTarget;
  const x = parseInt(cell.dataset.x);
  const y = parseInt(cell.dataset.y);
  if (currentPlayer === playerColor && isValidMove(x, y, currentPlayer)) {
    makeMove(x, y, currentPlayer);
    renderBoard();
    ws.send(JSON.stringify({ type: "move", x: x, y: y, room: networkRoomId }));
  } else {
    alert('そこには置けません');
  }
}

// 駒を置く処理
function makeMove(x, y, player) {
  board[y][x] = player;
  flipPieces(x, y, player);
}

// 駒の反転処理
function flipPieces(x, y, player) {
  const opponent = getOpponentColor(player);
  const directions = [
    [0, -1], [-1, -1], [-1, 0], [-1, 1],
    [0, 1], [1, 1], [1, 0], [1, -1]
  ];
  for (const [dx, dy] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let piecesToFlip = [];
    while (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
      if (board[ny][nx] === opponent) {
        piecesToFlip.push([nx, ny]);
        nx += dx;
        ny += dy;
      } else if (board[ny][nx] === player) {
        for (const [fx, fy] of piecesToFlip) {
          board[fy][fx] = player;
        }
        break;
      } else {
        break;
      }
    }
  }
}

// 駒が有効かどうかの判定
function isValidMove(x, y, player) {
  if (board[y][x] !== null) return false;
  const opponent = getOpponentColor(player);
  const directions = [
    [0, -1], [-1, -1], [-1, 0], [-1, 1],
    [0, 1], [1, 1], [1, 0], [1, -1]
  ];
  let valid = false;
  for (const [dx, dy] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let hasOpponentBetween = false;
    while (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
      if (board[ny][nx] === opponent) {
        hasOpponentBetween = true;
        nx += dx;
        ny += dy;
      } else if (board[ny][nx] === player && hasOpponentBetween) {
        valid = true;
        break;
      } else {
        break;
      }
    }
    if (valid) break;
  }
  return valid;
}

// 相手の色を返す関数
function getOpponentColor(player) {
  return player === "black" ? "white" : "black";
}

// 盤面状況とターンの表示更新
function updateStatus() {
  const blackCount = board.flat().filter(p => p === 'black').length;
  const whiteCount = board.flat().filter(p => p === 'white').length;
  let statusText = `黒: ${blackCount} / 白: ${whiteCount}　`;
  statusText += (currentPlayer === playerColor) ? "あなたの番です" : "相手の番です";
  statusDiv.textContent = statusText;
}

// 指定したプレイヤーの有効な駒一覧を取得
function getValidMoves(player) {
  let moves = [];
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      if (isValidMove(x, y, player)) {
        moves.push({ x, y });
      }
    }
  }
  return moves;
}

// 各駒の評価（ひっくり返せる駒の数を計算）
function evaluateMove(x, y, player) {
  let totalFlips = 0;
  const opponent = getOpponentColor(player);
  const directions = [
    [0, -1], [-1, -1], [-1, 0], [-1, 1],
    [0, 1], [1, 1], [1, 0], [1, -1]
  ];
  for (const [dx, dy] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let flips = 0;
    while (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
      if (board[ny][nx] === opponent) {
        flips++;
        nx += dx;
        ny += dy;
      } else if (board[ny][nx] === player && flips > 0) {
        totalFlips += flips;
        break;
      } else {
        break;
      }
    }
  }
  return totalFlips;
}

// 自動で最適な駒を選択して打つ処理（オートモード用）
let autoMoveTimeout = null;
function autoMakeMove() {
  if (gameOver) return; // ゲーム終了なら処理を中断
  
  autoMoveTimeout = null; // タイマーリセット

  if (currentPlayer !== playerColor) return; // 自分のターンでなければ中断

  const validMoves = getValidMoves(playerColor);
  if (validMoves.length === 0) {
    console.log("auto: 置ける場所がありません。パスします。");
    ws.send(JSON.stringify({ type: "pass", room: networkRoomId }));
    return;
  }
  let bestMove = null;
  let bestScore = -1;
  validMoves.forEach(move => {
    let score = evaluateMove(move.x, move.y, playerColor);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });
  if (bestMove) {
    console.log("auto: 最適な駒を選択:", bestMove, "スコア:", bestScore);
    makeMove(bestMove.x, bestMove.y, playerColor);
    renderBoard();
    ws.send(JSON.stringify({ type: "move", x: bestMove.x, y: bestMove.y, room: networkRoomId }));
  }
}

// パスまたはゲーム終了の判定
function checkForPassOrGameOver() {
  const myMoves = getValidMoves(playerColor);
  const oppMoves = getValidMoves(getOpponentColor(playerColor));
  if (myMoves.length === 0 && oppMoves.length === 0) {
    console.log("どちらも置ける場所がありません。ゲーム終了します。");
    endGame();
  } else if (currentPlayer === playerColor && myMoves.length === 0) {
    console.log("あなたの番ですが、置ける場所がありません。パスします。");
    ws.send(JSON.stringify({ type: "pass", room: networkRoomId }));
  }
}

// ゲーム終了時の処理
function endGame() {
  gameOver = true;
  if (autoMoveTimeout) {
    clearTimeout(autoMoveTimeout);
    autoMoveTimeout = null;
  }
  const blackCount = board.flat().filter(p => p === 'black').length;
  const whiteCount = board.flat().filter(p => p === 'white').length;
  let result = "";
  if (blackCount > whiteCount) {
    result = (playerColor === "black") ? "あなたの勝ちです！" : "あなたの負けです。";
  } else if (whiteCount > blackCount) {
    result = (playerColor === "white") ? "あなたの勝ちです！" : "あなたの負けです。";
  } else {
    result = "引き分けです。";
  }
  const gameResultDiv = document.getElementById('gameResult');
  gameResultDiv.textContent = "ゲーム終了！ " + result;
  gameResultDiv.style.display = 'block';
}

// ゲーム開始時の初期化と画面更新
function startGame() {
  gameOver = false; // ゲーム開始時は終了フラグをリセット
  currentPlayer = 'black';
  initBoard();
  gameDiv.style.display = 'grid';
  resetButton.style.display = 'inline';
  renderBoard();
  console.log("ゲーム開始: playerColor =", playerColor, "currentPlayer =", currentPlayer);
}

// リセットボタン押下時にページを再読み込み
resetButton.addEventListener('click', () => { location.reload(); });
