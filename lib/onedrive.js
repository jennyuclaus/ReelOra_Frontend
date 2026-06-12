const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac", ".wma", ".opus"];
const ROOT_FOLDER = "MeineMusik";

async function fetchFolderRecursive(accessToken, folderId, folderName = "", results = []) {
  let url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children` +
    `?$select=id,name,size,audio,file,folder,parentReference,@microsoft.graph.downloadUrl&$top=200`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      if (res.status === 401) throw new Error("401 Unauthorized – Token abgelaufen");
      break;
    }
    const data = await res.json();

    for (const item of data.value || []) {
      if (item.folder) {
        await fetchFolderRecursive(accessToken, item.id, item.name, results);
      } else if (item.file && AUDIO_EXTENSIONS.some(ext => item.name?.toLowerCase().endsWith(ext))) {
        results.push({
          id: item.id,
          name: item.name,
          title: item.audio?.title || item.name.replace(/\.[^.]+$/, ""),
          artist: item.audio?.artist || null,
          album: item.audio?.album || null,
          year: item.audio?.year || null,
          genre: item.audio?.genre || null,
          folder: folderName || ROOT_FOLDER,
          provider: "onedrive",
          streamUrl: item["@microsoft.graph.downloadUrl"] || null,
        });
      }
    }
    url = data["@odata.nextLink"] || null;
  }
  return results;
}

export async function fetchOneDriveFiles(accessToken) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${ROOT_FOLDER}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error("401 Unauthorized – Token abgelaufen");
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Ordner "${ROOT_FOLDER}" nicht gefunden.`);
  }
  const folder = await res.json();
  return fetchFolderRecursive(accessToken, folder.id, ROOT_FOLDER);
}

export async function getOneDriveStreamUrl(fileId, accessToken) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return data["@microsoft.graph.downloadUrl"] || null;
}

export async function fetchOneDrivePlaylists(accessToken) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/cloudplayer:/children?$filter=endswith(name,'.json')&$select=id,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.value || [];
}

export async function savePlaylistToOneDrive(accessToken, playlist) {
  const filename = `cloudplayer_playlist_${playlist.id}.json`;
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/cloudplayer/${filename}:/content`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(playlist),
    }
  );
  return res.json();
}
