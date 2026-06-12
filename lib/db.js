import { openDB } from "idb";

const DB_NAME = "cloudplayer";
const STORE = "playlists";

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    },
  });
}

export async function savePlaylists(playlists) {
  const db = await getDB();
  const tx = db.transaction(STORE, "readwrite");
  await Promise.all(playlists.map((p) => tx.store.put(p)));
  await tx.done;
}

export async function loadPlaylists() {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function savePlaylist(playlist) {
  const db = await getDB();
  await db.put(STORE, playlist);
}

export async function deletePlaylist(id) {
  const db = await getDB();
  await db.delete(STORE, id);
}
