import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import AuthProvider from './auth/AuthProvider'
import Landing from './landing/Landing'
import { LoginPage, RegisterPage } from './pages/AuthPages'
import { SpaceHome, SpacePage } from './pages/SpacePage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<RegisterPage />} />
          <Route path="/espace" element={<SpaceHome />} />
          <Route path="/espace/:slug" element={<SpacePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
