// Service Worker para PWA y procesamiento en segundo plano
const CACHE_NAME = 'patentes-app-v1';
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1364770233872683028/aO9YQi50PMv2LcaT8p_tmPVNQcNiUq9QBlZ20zZM52e6l9tsb70RA8Eg-GNpFCXZacbG";

// Archivos para cachear inicialmente
const urlsToCache = [
  '/Patentes/',
  '/Patentes/index.html',
  '/Patentes/manifest.json',
  '/Patentes/icons/icon-192x192.png',
  '/Patentes/icons/icon-512x512.png'
];

// Instalar el Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker instalándose');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caché abierto');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Forzar la activación inmediata
  );
});

// Activar el Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker activado');
  // Limpiar caches antiguos
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminando caché antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Tomar el control de los clientes inmediatamente
  );
});

// Manejar solicitudes de red
self.addEventListener('fetch', event => {
  // No interceptar solicitudes a Discord o proxies
  if (event.request.url.includes('discord.com') || 
      event.request.url.includes('corsproxy.io') ||
      event.request.url.includes('allorigins.win')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Si hay coincidencia en caché, devolver respuesta cacheada
        if (response) {
          return response;
        }
        
        // Si no hay coincidencia, ir a la red
        return fetch(event.request)
          .then(networkResponse => {
            // Si la respuesta no es válida, simplemente devolver la respuesta
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // Clonar la respuesta (porque se consume al usarla)
            var responseToCache = networkResponse.clone();
            
            // Guardar en caché para futuras solicitudes
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return networkResponse;
          })
          .catch(() => {
            // Si hay error de red y es una solicitud de página/documento, mostrar página offline
            if (event.request.mode === 'navigate') {
              return caches.match('/Patentes/offline.html');
            }
            // Para otros recursos, simplemente fallar
            return new Response('Sin conexión');
          });
      })
  );
});

// Manejar eventos de sincronización
self.addEventListener('sync', event => {
  if (event.tag === 'discord-sync') {
    console.log('Sincronizando mensajes en segundo plano');
    event.waitUntil(procesarColaMensajes());
  }
});

// Procesamiento periódico en segundo plano
self.addEventListener('periodicsync', event => {
  if (event.tag === 'discord-periodic-sync') {
    console.log('Sincronización periódica de mensajes');
    event.waitUntil(procesarColaMensajes());
  }
});

// Manejar notificaciones push
self.addEventListener('push', event => {
  const data = event.data.json();
  
  const options = {
    body: data.body || 'Hay notificaciones pendientes por enviar',
    icon: '/Patentes/icons/icon-192x192.png',
    badge: '/Patentes/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/Patentes/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification('Generador de Patentes', options)
  );
});

// Función para procesar cola de mensajes desde localStorage
async function procesarColaMensajes() {
  try {
    // Obtener mensajes pendientes
    let colaMensajes = [];
    
    // Intentar obtener desde el cliente
    const clients = await self.clients.matchAll();
    if (clients.length > 0) {
      // Solicitar los mensajes al cliente principal
      const client = clients[0];
      colaMensajes = await getQueueFromClient(client);
    } else {
      // Si no hay clientes activos, intentar obtener de localStorage directamente
      colaMensajes = getQueueFromStorage();
    }
    
    if (!colaMensajes || colaMensajes.length === 0) {
      console.log('No hay mensajes pendientes para enviar');
      return;
    }
    
    console.log(`Procesando ${colaMensajes.length} mensajes pendientes`);
    
    // Procesar los mensajes uno por uno
    for (let i = 0; i < colaMensajes.length; i++) {
      const item = colaMensajes[i];
      
      try {
        // Intentar enviar el mensaje
        const response = await fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(item.mensaje)
        });
        
        if (response.ok) {
          console.log(`Mensaje #${i+1} enviado correctamente`);
          
          // Informar al cliente que el mensaje se envió correctamente
          notifyClients(`Mensaje pendiente enviado en segundo plano (${i+1}/${colaMensajes.length})`);
          
          // Eliminar el mensaje de la cola
          colaMensajes.splice(i, 1);
          i--; // Ajustar el índice
          
          // Guardar la cola actualizada
          saveQueueToStorage(colaMensajes);
          
          // Enviar la cola actualizada a todos los clientes
          updateClientsQueue(colaMensajes);
          
          // Pausa entre envíos para evitar problemas con la API
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.error(`Error al enviar mensaje #${i+1}: ${response.status}`);
          
          // Intentar con proxy como respaldo
          const PROXY_URL = "https://corsproxy.io/?url=";
          const proxyResponse = await fetch(PROXY_URL + encodeURIComponent(DISCORD_WEBHOOK_URL), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(item.mensaje)
          });
          
          if (proxyResponse.ok) {
            console.log(`Mensaje #${i+1} enviado correctamente mediante proxy`);
            
            // Informar al cliente que el mensaje se envió correctamente
            notifyClients(`Mensaje pendiente enviado en segundo plano (${i+1}/${colaMensajes.length})`);
            
            // Eliminar el mensaje de la cola
            colaMensajes.splice(i, 1);
            i--; // Ajustar el índice
            
            // Guardar la cola actualizada
            saveQueueToStorage(colaMensajes);
            
            // Enviar la cola actualizada a todos los clientes
            updateClientsQueue(colaMensajes);
            
            // Pausa entre envíos
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (error) {
        console.error(`Error al procesar mensaje #${i+1}:`, error);
      }
    }
    
    console.log('Procesamiento de cola completado');
  } catch (error) {
    console.error('Error general al procesar cola:', error);
  }
}

// Solicitar cola de mensajes al cliente
async function getQueueFromClient(client) {
  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();
    
    messageChannel.port1.onmessage = event => {
      if (event.data && event.data.colaMensajes) {
        resolve(event.data.colaMensajes);
      } else {
        resolve([]);
      }
    };
    
    client.postMessage({ action: 'GET_QUEUE' }, [messageChannel.port2]);
    
    // Timeout para evitar bloqueos
    setTimeout(() => resolve([]), 3000);
  });
}

// Obtener cola de mensajes directamente de localStorage
function getQueueFromStorage() {
  try {
    // Nota: Este método podría no funcionar dependiendo del contexto del Service Worker
    // y las restricciones del navegador
    const data = localStorage.getItem('colaMensajesDiscord');
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error al obtener cola desde storage:', error);
  }
  return [];
}

// Guardar cola en localStorage
function saveQueueToStorage(cola) {
  try {
    localStorage.setItem('colaMensajesDiscord', JSON.stringify(cola));
  } catch (error) {
    console.error('Error al guardar cola en storage:', error);
  }
}

// Actualizar la cola en todos los clientes
async function updateClientsQueue(cola) {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ 
      action: 'UPDATE_QUEUE',
      colaMensajes: cola
    });
  });
}

// Notificar a los clientes
async function notifyClients(message) {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ 
      action: 'NOTIFICATION',
      message: message
    });
  });
}

// Manejar mensajes desde la página
self.addEventListener('message', event => {
  const data = event.data;
  
  if (data.action === 'SEND_NOTIFICATION') {
    // Procesar una notificación específica
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data.mensaje)
    })
    .then(response => {
      if (response.ok) {
        event.ports[0].postMessage({ success: true });
      } else {
        event.ports[0].postMessage({ success: false, error: response.statusText });
      }
    })
    .catch(error => {
      event.ports[0].postMessage({ success: false, error: error.message });
    });
  }
  
  if (data.action === 'PROCESS_QUEUE') {
    // Iniciar procesamiento de cola
    procesarColaMensajes();
  }
});
