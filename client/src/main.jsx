import {createRoot} from 'react-dom/client';
import {startTheme} from './lib/theme.js';
import App from './App.jsx';

startTheme();   // тема применяется до первого показа (запасной путь к theme-boot-v1.js)
createRoot(document.getElementById('root')).render(<App />);
