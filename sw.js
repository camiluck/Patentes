// Service Worker para enviar notificaciones en segundo plano
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1364770233872683028/aO9YQi50PMv2LcaT8p_tmPVNQcNiUq9QBlZ20zZM52e6l9tsb70RA8Eg-GNpFCXZacbG";

// Instalar el Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker instalado');
  self.skipWaiting(); // Forzar la activación inmediata
});

// Activar el Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker activado');
  return self.clients.claim(); // Tomar el control de los clientes inmediatamente
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
