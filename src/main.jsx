// StrictMode в режиме разработки дополнительно проверяет компоненты.
// Он не меняет то, что видит пользователь, и в собранном приложении лишней работы не делает.
import { StrictMode } from 'react'

// createRoot связывает React с обычным HTML-элементом на странице.
import { createRoot } from 'react-dom/client'

// Общие стили: цвета, шрифт, отступы страницы.
import './index.css'

// Компонент, который рисует всё содержимое страницы.
import App from './App.jsx'

// Ищем в index.html элемент <div id="root"> и отдаём его React.
// Если такого элемента нет, getElementById вернёт null и createRoot упадёт с ошибкой.
createRoot(document.getElementById('root')).render(
  // StrictMode оборачивает приложение, чтобы заранее поймать небезопасные приёмы.
  // В разработке React может вызвать компонент дважды. Это проверка, на экране дубля нет.
  <StrictMode>
    <App />
  </StrictMode>,
)
