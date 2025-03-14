const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const port = 3000;

app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// グローバル変数：ロビー内の待機クライアントとルーム管理
let lobby = []; // 待機中のクライアント
// 各ルームは { clients: [client1, client2], turn: "black" } の形式で管理
let rooms = {};
let nextRoomId = 1;

// ヘルパー関数: 指定された色の反対の色を返す
function getOpponentColor(player) {
  return player === "black" ? "white" : "black";
}

// ロビー一覧を全クライアントに送信する関数
function broadcastLobby() {
  const lobbyList = lobby.map(ws => ({ id: ws.id, name: ws.name }));
  const message = JSON.stringify({ type: "lobbyList", lobby: lobbyList });
  lobby.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
  console.log("【ロビー更新】待機中プレイヤー:", lobbyList);
}

wss.on('connection', (ws) => {
  // クライアントに固有IDと初期の名前を設定（後で setUsername で変更可能）
  ws.id = Date.now().toString() + Math.floor(Math.random() * 1000);
  ws.name = "Guest_" + ws.id.slice(-4);
  ws.room = null;
  ws.color = null; // 割り当てられた色（"black" または "white"）
  ws.matchRequested = false; // マッチングボタンを押したかどうか

  console.log(`クライアント ${ws.name} (ID:${ws.id}) が接続されました`);

  // 接続時はロビーに追加
  lobby.push(ws);
  broadcastLobby();

  ws.on('message', (message) => {
    const messageStr = message.toString();
    console.log(`[${ws.name}] から受信: ${messageStr}`);
    let msg;
    try {
      msg = JSON.parse(messageStr);
    } catch (err) {
      console.error(`[${ws.name}] メッセージのパースに失敗:`, err);
      return;
    }

    // ユーザー名設定
    if (msg.type === 'setUsername') {
      ws.name = msg.username;
      console.log(`クライアント ${ws.id} の名前を ${ws.name} に設定しました`);
      broadcastLobby();
      return;
    }

    // ★ マッチング処理：matchRequest を受信した場合 ★
    if (msg.type === 'matchRequest') {
      console.log(`${ws.name} が matchRequest リクエストを送信しました`);
      ws.matchRequested = true; // マッチングボタンを押したことを記録

      // ロビー内に重複があれば除外し、必ず最新状態にする
      lobby = lobby.filter(client => client !== ws);
      lobby.push(ws);

      // 両者のmatchRequestが反映されるように、短い遅延後に処理を開始
      setTimeout(() => {
        // 待機中のクライアントから、matchRequestedがtrueかつまだルームに所属していないクライアントを抽出
        let waitingClients = lobby.filter(client => client.matchRequested && !client.room);
        console.log("マッチング待機中のクライアント:", waitingClients.map(c => c.name));
        if (waitingClients.length >= 2) {
          // 先頭2名を取得
          const client1 = waitingClients[0];
          const client2 = waitingClients[1];
          // ロビーから2名を削除
          lobby = lobby.filter(client => client !== client1 && client !== client2);
          const roomId = "room" + nextRoomId++;
          client1.room = roomId;
          client2.room = roomId;
          // ルーム作成（初期ターンは "black"）
          rooms[roomId] = { clients: [client1, client2], turn: "black" };
          // ランダムに色を割り当てる
          if (Math.random() < 0.5) {
            client1.color = "black";
            client2.color = "white";
          } else {
            client1.color = "white";
            client2.color = "black";
          }
          console.log(`${client1.name} (${client1.color}) と ${client2.name} (${client2.color}) が ${roomId} でマッチングしました`);
          client1.send(JSON.stringify({ type: "matched", room: roomId, opponent: client2.name, color: client1.color }));
          client2.send(JSON.stringify({ type: "matched", room: roomId, opponent: client1.name, color: client2.color }));
        } else {
          // パートナーが見つからなかった場合は待機中メッセージを送信
          ws.send(JSON.stringify({ type: "waiting", message: "お相手のマッチング待ちです..." }));
        }
        broadcastLobby();
      }, 10); // 10msの遅延
      return;
    }
    // ★ ここまでマッチング処理 ★

    // ゲーム中の操作（move, pass）
    else if (msg.type === 'move' || msg.type === 'pass') {
      const roomId = ws.room;
      if (roomId && rooms[roomId]) {
        // サーバー側で、送信者が現在のターンであるかチェック
        if (rooms[roomId].turn !== ws.color) {
          console.log(`[${ws.name}] はターンではありません。無視します。`);
          return;
        }
        console.log(`${ws.name} の ${msg.type} を ${roomId} の相手に転送します`);
        rooms[roomId].clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
          }
        });
        // ターン切替
        rooms[roomId].turn = getOpponentColor(rooms[roomId].turn);
        // 全クライアントに turnUpdate を送信
        rooms[roomId].clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "turnUpdate", currentTurn: rooms[roomId].turn }));
          }
        });
        console.log(`ルーム ${roomId} のターンが ${rooms[roomId].turn} に更新されました`);
      }
    }
  });

  ws.on('close', () => {
    console.log(`クライアント ${ws.name} の接続が切断されました`);
    lobby = lobby.filter(client => client !== ws);
    if (ws.room && rooms[ws.room]) {
      rooms[ws.room].clients = rooms[ws.room].clients.filter(client => client !== ws);
      if (rooms[ws.room].clients.length === 1) {
        const remaining = rooms[ws.room].clients[0];
        console.log(`ルーム ${ws.room} で ${ws.name} が退出。残った ${remaining.name} をロビーに戻します`);
        remaining.send(JSON.stringify({ type: "opponentLeft", message: "相手が退出しました" }));
        remaining.room = null;
        remaining.matchRequested = false; // マッチングリクエストをリセット
        lobby.push(remaining);
        broadcastLobby();
      } else if (rooms[ws.room].clients.length === 0) {
        console.log(`ルーム ${ws.room} が空になったので削除します`);
        delete rooms[ws.room];
      }
    }
    broadcastLobby();
  });
});

server.listen(port, () => {
  console.log(`HTTPサーバーが http://localhost:${port} で稼働中です`);
});
