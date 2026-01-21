import React, { useState, useEffect } from 'react';
import './App.css';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';

// TODO: Replace with your Firebase config from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyBMYxs5_mEaCVzDyeAjTKJAafkHT_7f94A",
  authDomain: "poker-planning-c1d24.firebaseapp.com",
  projectId: "poker-planning-c1d24",
  storageBucket: "poker-planning-c1d24.firebasestorage.app",
  messagingSenderId: "375856991794",
  appId: "1:375856991794:web:d156d23e3a839c2212f62b"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const FIBONACCI_VALUES = [1, 2, 3, 5, 8, "?"];
const SESSION_ID = 'default-session'; // You can make this dynamic later

export default function PokerPlanningApp() {
  const [currentUser, setCurrentUser] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [players, setPlayers] = useState({});
  const [sessionData, setSessionData] = useState({ revealed: false, storyTitle: '' });
  const [storyTitleInput, setStoryTitleInput] = useState('');
  const [sessionHistory, setSessionHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  // Listen to all players in real-time
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'sessions', SESSION_ID, 'players'),
      (snapshot) => {
        const playersData = {};
        snapshot.forEach((doc) => {
          playersData[doc.id] = doc.data();
        });
        setPlayers(playersData);
      }
    );

    return () => unsubscribe();
  }, []);

  // Listen to session state (revealed status and story title)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'sessions', SESSION_ID),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setSessionData(data);
          setStoryTitleInput(data.storyTitle || '');
          // Sync sessionHistory with Firebase
          if (data.sessionHistory) {
            setSessionHistory(data.sessionHistory);
          }
        }
      }
    );
    return () => unsubscribe();
  }, []);

  // Update story title in Firestore
  const handleStoryTitleChange = async (e) => {
    const value = e.target.value;
    setStoryTitleInput(value);
    await setDoc(doc(db, 'sessions', SESSION_ID), { ...sessionData, storyTitle: value }, { merge: true });
  };

  // Add current user to Firestore
  const handleNameSubmit = async (e) => {
    setLoading(true);
    e?.preventDefault();
    if(nameInput.trim() === '') {
      setLoading(false);
      return alert('Por favor ingresa un nombre válido.');
    }
    
    const userName = nameInput.trim();
    
    // Check if a player with the same name already exists
    if (players[userName]) {
      setLoading(false);
      return alert(`El nombre "${userName}" ya está en la sesión. Por favor elige otro nombre.`);
    }
    
    if (nameInput.trim()) {
      // If this is the first player joining, ensure session starts as a new round
      if (Object.keys(players).length === 0) {
        await setDoc(doc(db, 'sessions', SESSION_ID), { revealed: false }).catch(() => { });
      }

      setCurrentUser(userName);

      // Add player to Firestore
      await setDoc(doc(db, 'sessions', SESSION_ID, 'players', userName), {
        name: userName,
        vote: null,
        timestamp: serverTimestamp()
      });
    }
    setLoading(false);
  };

  // Update vote in Firestore
  const handleVote = async (value) => {
    if (!currentUser) return;

    await setDoc(doc(db, 'sessions', SESSION_ID, 'players', currentUser), {
      name: currentUser,
      vote: value,
      timestamp: serverTimestamp()
    });
  };

  // Reveal all votes
  const handleReveal = async () => {
    await setDoc(doc(db, 'sessions', SESSION_ID), {
      revealed: true
    });
  };

  // Start new round
  const handleNewRound = async () => {
    // Reset revealed status
    await setDoc(doc(db, 'sessions', SESSION_ID), {
      revealed: false
    });

    // Clear all votes
    const playerNames = Object.keys(players);
    for (const name of playerNames) {
      await setDoc(doc(db, 'sessions', SESSION_ID, 'players', name), {
        name: name,
        vote: null,
        timestamp: serverTimestamp()
      });
    }
  };

  // Presence: heartbeat + cleanup on unload/unmount
  useEffect(() => {
    if (!currentUser) return;

    const playerRef = doc(db, 'sessions', SESSION_ID, 'players', currentUser);

    const heartbeat = () => {
      // update only the timestamp to indicate presence
      setDoc(playerRef, { timestamp: serverTimestamp() }, { merge: true }).catch(() => { });
    };

    // initial heartbeat and periodic updates
    heartbeat();
    const hbInterval = setInterval(heartbeat, 10000);

    const removePlayer = () => {
      // best-effort: try to delete player doc when leaving
      deleteDoc(playerRef).catch(() => { });
    };

    window.addEventListener('beforeunload', removePlayer);

    return () => {
      clearInterval(hbInterval);
      window.removeEventListener('beforeunload', removePlayer);
      // attempt to remove on component unmount as well
      removePlayer();
    };
  }, [currentUser]);

  // Client-side prune of stale players (last heartbeat older than ~30s)
  useEffect(() => {
    const prune = async () => {
      const now = Date.now();
      for (const [name, p] of Object.entries(players)) {
        const ts = p?.timestamp;
        let tMillis = 0;
        if (ts && typeof ts.toMillis === 'function') {
          tMillis = ts.toMillis();
        } else if (ts) {
          tMillis = new Date(ts).getTime();
        }
        if (tMillis && now - tMillis > 30000) {
          await deleteDoc(doc(db, 'sessions', SESSION_ID, 'players', name)).catch(() => { });
        }
      }
    };

    const pruneInterval = setInterval(prune, 20000);
    return () => clearInterval(pruneInterval);
  }, [players]);

  const calculateStats = () => {
    const votes = Object.values(players)
      .map(p => p.vote)
      .filter(v => v !== null && v !== undefined && v !== "?");

    if (votes.length === 0) return null;

    const counts = {};
    votes.forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
    });
    // determine mode(s) and handle ties
    const maxCount = Math.max(...Object.values(counts));
    const winners = Object.keys(counts).filter(k => counts[k] === maxCount);
    const mode = winners.length === 1 ? winners[0] : null; // null indicates no single mode
    const modeCount = maxCount;
    const agreement = ((modeCount / votes.length) * 100).toFixed(0);
    const average = (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1);

    return {
      mode,
      modeOptions: winners,
      agreement,
      average,
      totalVotes: votes.length,
      totalPlayers: Object.keys(players).length
    };
  };

  // Name Entry Screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-800 to-orange-400 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-3xl font-bold text-center mb-6 text-gray-800">
            🃏 Planning Poker 
          </h1>
          <h3 className="text-2xl font-bold text-center mb-6 text-gray-800">Medifé App</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ingresa tu nombre
              </label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                placeholder="Tu nombre..."
                autoFocus
                required
                disabled={loading}
              />
            </div>
            <button
              onClick={handleNameSubmit}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-lg transition duration-200"
              disabled={loading}
            >
              {loading ? 'Uniendo...' : 'Unirse'}
            </button>
            {loading && (
              <div className="flex justify-center items-center mt-2">
                <svg className="animate-spin h-5 w-5 text-orange-600 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                </svg>
                <span className="text-orange-600 font-semibold">Uniendote...</span>
              </div>
            )}
          </div>
          <div className="mt-6 p-4 bg-orange-50 rounded-lg">
            <div className="text-sm text-gray-600 text-center">
              <div className="font-semibold mb-1">👥 Participantes activos: {Object.keys(players).length}</div>
              <div className="text-xs">
                {Object.keys(players).length > 0
                  && Object.keys(players).join(', ')
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stats = sessionData.revealed ? calculateStats() : null;
  const playersList = Object.values(players);


  // Prepare vote counts for the distribution visualization
  // Build voteCounts and voteToPlayers for distribution panel
  const voteCounts = {};
  const voteToPlayers = {};
  Object.values(players).forEach(p => {
    const v = p?.vote;
    if (v !== null && v !== undefined) {
      voteCounts[v] = (voteCounts[v] || 0) + 1;
      if (!voteToPlayers[v]) voteToPlayers[v] = [];
      voteToPlayers[v].push(p.name);
    }
  });

  // Sort winners to the top for vote distribution
  let voteEntries = Object.entries(voteCounts);
  if (stats && stats.modeOptions && stats.modeOptions.length > 0) {
    voteEntries = [
      ...voteEntries.filter(([val]) => stats.modeOptions.includes(val)),
      ...voteEntries.filter(([val]) => !stats.modeOptions.includes(val)),
    ];
  }
  const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);

  // Find players who have not voted
  const notVotedPlayers = playersList.filter(p => p.vote === null || p.vote === undefined);

  // Show alert if only one player left to vote and not revealed
  const showOneLeftAlert = !sessionData.revealed && notVotedPlayers.length === 1;
  
  const oneLeftName = showOneLeftAlert ? notVotedPlayers[0].name?.replace(/\b\w/g, c => c.toUpperCase()) : '';
  
  // Position players around the table
  function getPlayerPosition(index, total) {
    const angle = (2 * Math.PI * index) / total - Math.PI / 2;

    const radius = 65; // % of container (outside the table) - increased to prevent overlap

    return {
      x: 50 + radius * Math.cos(angle),
      y: 50 + radius * Math.sin(angle),
    };
  } 

  const hasCurrentStoryTitle = (sessionData.storyTitle || '').trim().length > 0;
  const isCurrentStorySaved = hasCurrentStoryTitle && sessionHistory.some((h) => h.storyTitle === sessionData.storyTitle);

  const handleSaveVotingResult = async () => {
    if (!sessionData.revealed || !stats) return;
    if (!hasCurrentStoryTitle) {
      alert('Ingresa el nombre de la historia para guardar la votación');
      return;
    }
    if (isCurrentStorySaved) return;

    const entry = {
      storyTitle: sessionData.storyTitle,
      mode: stats.mode,
      agreement: stats.agreement,
      average: stats.average,
      totalVotes: stats.totalVotes,
      totalPlayers: stats.totalPlayers,
      votes: playersList.map(p => ({ name: p.name, vote: p.vote })),
      createdAt: new Date().toISOString()
    };

    const updatedHistory = [...sessionHistory, entry];

    await setDoc(doc(db, 'sessions', SESSION_ID), {
      sessionHistory: updatedHistory
    }, { merge: true });

    setSessionHistory(updatedHistory);
  };

  return (
    <div className="h-screen flex flex-col mainBG gap-4">
      {/* Alert: Only one player left to vote */}
      {showOneLeftAlert && (
        <div className="fixed left-0 top-1/4 z-40 bg-secondary-orange text-white font-bold px-6 py-4 rounded-r-lg shadow-lg text-lg flex items-center animate-pulse" style={{ minWidth: '220px' }}>
          <span className="mr-2">⚠️ Falta votar:</span> <span className="ml-1 underline">{oneLeftName}</span>
        </div>
      )}

      {/* Header */}
      <div className="bg-orange-400 backdrop-blur-sm text-white p-4 shadow-lg">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold">🃏Planning Poker </h1>
          <div className="text-sm">
            <span className="font-semibold">{currentUser}</span>
            <span className="ml-4">👥 {playersList.length} participantes</span>
          </div>
        </div>
      </div>

      {/* Story Title Input */}
      {/* Main Game Area + Vote Distribution Side-by-Side */}
    {  console.log(sessionHistory.length) }
      {sessionHistory.length > 0 && (
        <div className="fixed left-4 top-24 z-30 bg-white/95 border border-secondary-orange rounded-lg shadow-md p-3 w-64 max-h-72 overflow-auto">
          <div className="text-sm font-bold text-secondary-orange mb-2">Historias guardadas</div>
          <div className="space-y-2">
            {sessionHistory.map((item, idx) => (
              <div key={`${item.storyTitle}-mini-${idx}`} className="border border-orange-200 rounded-md p-2 bg-white">
                <div className="text-sm font-semibold text-gray-900 truncate" title={item.storyTitle}>{item.storyTitle}</div>
                <div className="text-xs text-gray-700 mt-1">Más votado: <span className="font-bold text-secondary-orange">{item.mode || '-'}</span></div>
                <div className="text-[11px] text-gray-600 mt-1">{item.totalVotes} / {item.totalPlayers} votos · {item.average} prom</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="w-full flex flex-col items-center mt-5">
        <input
          type="text"
          
          value={storyTitleInput}
          onChange={handleStoryTitleChange}
          placeholder="Ingresa el título de la historia en votación"
          className="text-center w-full max-w-md rounded p-1 mb-4"
        />
      </div>
      {/* Main Game Area + Vote Distribution Side-by-Side */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 pb-6 gap-12 overflow-auto">

        {/* Results Card - Displayed Above Table when Revealed */}
        {sessionData.revealed && stats && (
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full border-2 border-secondary-orange mb-6">
            <div className="text-center space-y-3">
              <div className="text-2xl font-bold text-secondary-orange">{stats?.mode || '-'}</div>
              <div className="text-lg font-semibold text-gray-800">Más Votado</div>
              {hasCurrentStoryTitle && (
                <div className="text-sm text-gray-600 font-semibold" title={sessionData.storyTitle}>Historia: {sessionData.storyTitle}</div>
              )}
              <div className="text-sm space-y-1 text-gray-700">
                <p className="font-semibold">{stats?.agreement}% Acuerdo</p>
                <p>Promedio: {stats?.average}</p>
                <p>{stats?.totalVotes} / {stats?.totalPlayers} votaron</p>
              </div>
              <button
                onClick={handleNewRound}
                className="mt-4 w-full bg-secondary-orange hover:bg-orange-500 text-white font-semibold py-3 px-6 rounded-full text-base transition duration-200 transform hover:scale-105"
              >
                🔄 Reiniciar
              </button>
            </div>
          </div>
        )}

        {/* Player Voting Cards Row - Displayed when Revealed */}
        {sessionData.revealed && (
          <div className="w-full flex justify-center px-4">
            <div className="flex flex-wrap justify-center gap-4 max-w-6xl">
              {playersList.map((player) => (
                <div key={player.name} className="flex flex-col items-center gap-2">
                  {/* Vote Card */}
                  <div className="w-16 h-24 bg-white rounded-lg shadow-lg flex items-center justify-center font-bold text-2xl text-secondary-orange border-2 border-secondary-orange">
                    {player.vote || '-'}
                  </div>
                  {/* Player Name */}
                  <div className="text-sm font-semibold px-3 py-2 bg-secondary-orange text-white rounded-full whitespace-nowrap text-center max-w-[120px] overflow-hidden text-ellipsis">
                    {player?.name?.replace(/\b\w/g, c => c.toUpperCase())}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {!sessionData.revealed && (
        <div className="relative w-full max-w-3xl h-64 flex-shrink-0 flex items-center justify-center">
          {/* Pill-shaped Poker Table */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full h-3/4 max-w-3xl bg-table-wood rounded-full border-[10px] border-table-rim shadow-2xl flex items-center justify-center">
              <div className="w-[97%] h-[85%] bg-table-felt rounded-full flex items-center justify-center shadow-inner">
                <div className="text-center px-4">
                  {!sessionData.revealed && (
                    <button
                      onClick={handleReveal}
                      disabled={playersList.filter(p => p.vote !== null).length === 0}
                      className="bg-secondary-orange hover:bg-orange-500 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-bold py-4 px-8 rounded-full text-xl shadow-lg transition duration-100 transform hover:scale-105"
                    >
                      🎭 Revelar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Player Cards in a horizontal row */}
          {playersList.map((player, index) => {
            const pos = getPlayerPosition(index, playersList.length);
            const hasVoted = player.vote !== null && player.vote !== undefined;
            const isCurrentUser = player.name === currentUser;

            return (
              <div
                key={player.name}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <div className="flex flex-col items-center gap-2">
                  {/* Card */}
                  <div
                    className={`w-14 h-20 rounded-lg shadow-lg flex items-center justify-center font-bold text-lg transition-all duration-300 ${hasVoted
                      ? sessionData.revealed
                        ? 'bg-white text-gray-900'
                        : 'bg-white text-secondary-orange border-2 border-secondary-orange'
                      : 'bg-white/40 text-white/40 border-2 border-white/40 border-dashed'
                      }`}
                  >
                    {hasVoted
                      ? sessionData.revealed
                        ? player.vote
                        : (
                          <span className="flex flex-col items-center">
                            <span className="text-2xl">✔️</span>
                            <span className="text-s mt-1 text-green-900 font-semibold">Listo</span>
                          </span>
                        )
                      : '?'}
                  </div>

                  {/* Name */}
                  <div
                    className={`text-sm font-semibold px-5 py-3 rounded-full whitespace-nowrap overflow-hidden text-ellipsis ${isCurrentUser
                        ? 'bg-secondary-orange text-white'
                        : 'bg-white/90 text-gray-900'
                      }`}
                    style={{ maxWidth: 140 }}
                  >
                    {player?.name?.replace(/\b\w/g, c => c.toUpperCase())}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Vote Distribution (floating panel on desktop, below on mobile) */}
      {sessionData.revealed && totalVotes > 0 && (
        <div
          className="fixed md:absolute z-30 right-0 md:right-8 top-auto md:top-1/2 md:-translate-y-1/2 w-full md:w-80 max-w-full md:max-w-xs mt-6 md:mt-0 flex-shrink-0 pointer-events-auto"
          style={{ bottom: '9.5rem' }}
        >
          <div className="bg-accent-light p-4 rounded-lg border border-secondary-orange shadow-2xl backdrop-blur-md">
            <div className="flex items-start justify-between mb-3 gap-2">
              <div>
                <h3 className="text-secondary-orange font-semibold">Distribución de votos</h3>
                {hasCurrentStoryTitle && (
                  <div className="text-xs text-gray-800 font-semibold truncate" title={sessionData.storyTitle}>Historia: {sessionData.storyTitle}</div>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {(() => {
                // Find the last winner index (after sorting winners to top)
                const winnerCount = stats && stats.modeOptions ? stats.modeOptions.length : 0;
                return voteEntries.map(([val, count], idx) => {
                  const pct = Math.round((count / totalVotes) * 100);
                  const isWinner = stats && stats.modeOptions && stats.modeOptions.includes(val);
                  // Separator after last winner if there are non-winners
                  const separator = winnerCount > 0 && idx === winnerCount - 1 && voteEntries.length > winnerCount;
                  const voters = (voteToPlayers[val] || []).map(name => (
                    <span key={name} className="text-orange-500 text-xs font-semibold mr-2 border border-orange-500 px-2 py-1 rounded-full bg-white/10 mb-1 inline-block">
                      {name?.replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  ));
                  return (
                    <React.Fragment key={val}>
                      <div className={`flex items-center gap-3 ${isWinner ? 'font-bold' : ''}`}>
                        <div
                          className={`w-10 h-14 flex items-center justify-center rounded-lg border shadow font-bold text-lg bg-white/90 ${isWinner ? 'border-secondary-orange text-secondary-orange' : 'border-gray-300 text-gray-900'}`}
                          style={{ minWidth: 40 }}
                        >
                          {val}
                        </div>
                        <div className={`flex-1 rounded h-6 overflow-hidden border ${isWinner ? 'bg-accent-light border-secondary-orange' : 'bg-gray-200 border-gray-300'}`}>
                          <div
                            className={`h-6 ${isWinner ? 'bg-secondary-orange' : 'bg-accent-light'} shadow-md`}
                            style={{ width: `${pct}%`, minWidth: pct === 0 ? '6px' : undefined }}
                          />
                        </div>
                        <div className={`w-16 text-sm text-right ${isWinner ? 'text-secondary-orange' : 'text-gray-900'}`}>{count} ({pct}%)</div>
                      </div>
                      {/* Voters for this card */}
                      {voters.length > 0 && (
                        <div className="flex flex-wrap items-center ml-12 mb-1 ">
                          {voters}
                        </div>
                      )}
                      {separator && (
                        <div className="my-2 border-t-2 border-secondary-orange opacity-70" />
                      )}
                    </React.Fragment>
                  );
                });
              })()}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSaveVotingResult}
                disabled={isCurrentStorySaved}
                className={`text-xs font-semibold px-4 py-2 rounded-md border ${isCurrentStorySaved
                  ? 'bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed'
                  : 'bg-secondary-orange text-white border-secondary-orange hover:bg-orange-500'}
                `}
                title={hasCurrentStoryTitle ? '' : 'Ingresa el nombre de la historia para guardar la votación'}
              >
                Guardar votación
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Voting Cards Footer (in-flow so it occupies space and won't overlap) */}
      {!sessionData.revealed && (
        <div className="shadow-lg h-32 border-t bg-accent-light backdrop-blur-sm mt-auto pb-4">
          <div className="max-w-7xl mx-auto h-full flex flex-col justify-center">
            <div className="flex justify-center gap-2 flex-wrap">
              {FIBONACCI_VALUES.map((value) => (
                <button
                  key={value}
                  onClick={() => handleVote(value)}
                  className={`w-14 h-20 rounded-lg shadow-lg font-bold text-lg transition-all duration-200 transform hover:scale-105 hover:-translate-y-1 ${players[currentUser]?.vote === value
                    ? 'bg-secondary-orange text-white scale-105 -translate-y-1'
                    : 'bg-white text-gray-900 hover:bg-accent-light'
                    }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}