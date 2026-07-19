import { formatMap, jsonToNetscapeMapper } from './modules/cookie_format.mjs';
import getAllCookies from './modules/get_all_cookies.mjs';
import _saveToFile from './modules/save_to_file.mjs';

/** 
 * Promesa optimizada para obtener la URL de la pestaña activa.
 * En Android (móvil), 'currentWindow' puede fallar, por lo que usamos alternativamente 'lastFocusedWindow'.
 */
const getUrlPromise = chrome.tabs
  .query({ active: true, currentWindow: true })
  .then((tabs) => {
    if (tabs && tabs.length > 0) return tabs;
    // Si falla en Android, busca en la última ventana enfocada
    return chrome.tabs.query({ active: true, lastFocusedWindow: true });
  })
  .then(([tab]) => {
    if (!tab || !tab.url) {
      throw new Error('No se pudo detectar una pestaña activa con una URL válida.');
    }
    return new URL(tab.url);
  })
  .catch((err) => {
    console.error("Error obteniendo URL:", err);
    // URL de respaldo para evitar que la interfaz se congele por completo si falla la API
    return new URL('https://www.google.com'); 
  });

// ----------------------------------------------
// Functions
// ----------------------------------------------

/**
 * Get Stringified Cookies Text and Format Data
 * @param {chrome.cookies.GetAllDetails} details
 * @returns {Promise<{ text: string, format: Format }>}
 */
const getCookieText = async (details) => {
  const cookies = await getAllCookies(details);
  const format = formatMap[document.querySelector('#format').value];
  if (!format) throw new Error('Invalid format');
  const text = format.serializer(cookies);
  return { text, format };
};

/**
 * Save text data as a file
 */
const saveToFile = async (text, name, { ext, mimeType }, saveAs = false) => {
  const format = { ext, mimeType };
  const isFirefox =
    chrome.runtime.getManifest().browser_specific_settings !== undefined; //
    
  if (isFirefox) {
    try {
      // Forzar la generación del archivo y descarga en primer plano para Firefox Android
      const blob = new Blob([text], { type: mimeType || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}${ext}`; // Asegura el nombre correcto con su extensión
      
      document.body.appendChild(a);
      a.click();
      
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error en la descarga local por Blob, reintentando por canal background:", err);
      // Fallback por si acaso falla en alguna circunstancia de escritorio
      await chrome.runtime.sendMessage({
        type: 'save',
        target: 'background',
        data: { text, name, format, saveAs },
      });
    }
  } else {
    await _saveToFile(text, name, format, saveAs); //
  }
};

/**
 * Copy text data to the clipboard
 * @param {string} text
 */
const setClipboard = async (text) => {
  await navigator.clipboard.writeText(text);
  const copyButton = document.getElementById('copy');
  copyButton.classList.add('copied');
  setTimeout(() => {
    copyButton.classList.remove('copied');
  }, 2000);
};

// ----------------------------------------------
// Actions after resolving the promise
// ----------------------------------------------

/** Set URL in the header */
getUrlPromise.then((url) => {
  const location = document.querySelector('#location');
  if (location) location.textContent = location.href = url.href;
});

/** Set Cookies data to the table */
getUrlPromise
  .then((url) =>
    getAllCookies({
      url: url.href,
      partitionKey: { topLevelSite: url.origin },
    }),
  )
  .then((cookies) => {
    const netscape = jsonToNetscapeMapper(cookies);
    const tableRows = netscape.map((row) => {
      const tr = document.createElement('tr');
      tr.replaceChildren(
        ...row.map((v) => {
          const td = document.createElement('td');
          td.textContent = v;
          return td;
        }),
      );
      return tr;
    });
    const tbody = document.querySelector('table tbody');
    if (tbody) tbody.replaceChildren(...tableRows);
  })
  .catch(err => console.error("Error al renderizar la tabla:", err));

// ----------------------------------------------
// Event Listeners (Compatibilidad Táctil Mejorada)
// ----------------------------------------------

const asignarEventoMovil = (selector, callback) => {
  const elemento = document.querySelector(selector);
  if (!elemento) return;

  // Ejecuta la acción inmediatamente al detectar el fin del toque, evitando retardos en Android
  elemento.addEventListener('touchend', async (e) => {
    e.preventDefault(); // Evita que se dispare el evento click fantasma de atrás
    await callback();
  });

  // Mantiene compatibilidad con clics de mouse tradicionales en PC
  elemento.addEventListener('click', async (e) => {
    if (e.pointerType === 'touch') return; // Ignora clics emulados por toques
    await callback();
  });
};

asignarEventoMovil('#export', async () => {
  const url = await getUrlPromise;
  const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
  const { text, format } = await getCookieText(details);
  await saveToFile(text, `${url.hostname}_cookies`, format);
});

asignarEventoMovil('#exportAs', async () => {
  const url = await getUrlPromise;
  const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
  const { text, format } = await getCookieText(details);
  await saveToFile(text, `${url.hostname}_cookies`, format, true);
});

asignarEventoMovil('#copy', async () => {
  const url = await getUrlPromise;
  const details = { url: url.href, partitionKey: { topLevelSite: url.origin } };
  const { text } = await getCookieText(details);
  await setClipboard(text);
});

asignarEventoMovil('#exportAll', async () => {
  const { text, format } = await getCookieText({ partitionKey: {} });
  await saveToFile(text, 'cookies', format);
});

/** Set last used format value */
const formatSelect = document.querySelector('#format');
if (formatSelect) {
  const selectedFormat = localStorage.getItem('selectedFormat');
  if (selectedFormat) {
    formatSelect.value = selectedFormat;
  }

  formatSelect.addEventListener('change', () => {
    localStorage.setItem('selectedFormat', formatSelect.value);
  });
}
