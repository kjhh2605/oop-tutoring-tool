import { createRoot } from 'react-dom/client'
import { TuteeApp } from './pages/TuteeApp.tsx'
import { TutorApp } from './pages/TutorApp.tsx'
import './styles.css'

const isTutor = window.location.pathname.replace(/\/+$/, '') === '/tutor'

createRoot(document.getElementById('root')!).render(isTutor ? <TutorApp /> : <TuteeApp />)
