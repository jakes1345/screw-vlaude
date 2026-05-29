import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket(url) {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const s = io(url, { transports: ['websocket'] });
    setSocket(s);
    return () => { s.disconnect(); };
  }, [url]);

  return socket;
}
