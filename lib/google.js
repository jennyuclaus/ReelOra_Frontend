const AUDIO_MIMETYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/x-m4a",
  "audio/webm",
];

const AUDIO_QUERY = AUDIO_MIMETYPES.map(
  (m) => `mimeType='${m}'`
).join(" or ");

export async function fetchGoogleDriveFiles(accessToken, pageToken = null) {
  const params = new URLSearchParams({
    q: `(${AUDIO_QUERY}) and trashed=false`,
    fields:
      "nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,parents)",
    pageSize: "100",
    orderBy: "name",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error("Google Drive API error: " + res.status);
  return res.json();
}

export async function getGoogleStreamUrl(fileId, accessToken) {
  // Returns a direct stream URL via the Drive API
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${accessToken}`;
}

export async function fetchGooglePlaylists(accessToken) {
  // Playlists stored as JSON files in a special folder
  const params = new URLSearchParams({
    q: `mimeType='application/json' and name contains 'cloudplayer_playlist' and trashed=false`,
    fields: "files(id,name,modifiedTime)",
  });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

export async function savePlaylistToGoogle(accessToken, playlist) {
  const filename = `cloudplayer_playlist_${playlist.id}.json`;
  const blob = new Blob([JSON.stringify(playlist)], {
    type: "application/json",
  });

  // Check if file exists
  const existing = await fetchGooglePlaylists(accessToken);
  const existingFile = existing.find((f) =>
    f.name.includes(playlist.id)
  );

  if (existingFile) {
    // Update existing
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(playlist),
      }
    );
    return res.json();
  } else {
    // Create new
    const metadata = { name: filename, mimeType: "application/json" };
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", blob);
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );
    return res.json();
  }
}

export async function loadPlaylistFromGoogle(accessToken, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.json();
}
