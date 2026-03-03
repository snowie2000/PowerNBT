import React from 'react'
import { ConfigProvider, App as AntApp } from 'antd'
import { AppLayout } from './components/layout/AppLayout'

const App: React.FC = () => (
  <ConfigProvider
    theme={{
      token: {
        colorPrimary: '#1677ff',
        borderRadius: 6,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      },
    }}
  >
    <AntApp>
      <AppLayout />
    </AntApp>
  </ConfigProvider>
)

export default App
