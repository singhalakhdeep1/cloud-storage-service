'use client';

import { useState } from 'react';
import { Settings, Slack, Dropbox, Drive, Save, Check } from 'lucide-react';

export default function IntegrationSettings() {
    const [settings, setSettings] = useState({
        slack: {
            enabled: false,
            webhookUrl: ''
        },
        dropbox: {
            enabled: false,
            accessToken: ''
        },
        googleDrive: {
            enabled: false,
            accessToken: ''
        }
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);

        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));

        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const updateSetting = (provider, field, value) => {
        setSettings({
            ...settings,
            [provider]: {
                ...settings[provider],
                [field]: value
            }
        });
    };

    return (
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
            <h2 className="text-2xl font-bold mb-5 text-gray-800 flex items-center gap-2">
                <Settings className="w-6 h-6" />
                Integration Settings
            </h2>

            <div className="space-y-6">
                {/* Slack Integration */}
                <div className="border border-gray-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                <Slack className="w-6 h-6 text-purple-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-800">Slack</h3>
                                <p className="text-sm text-gray-600">Send notifications to Slack</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={settings.slack.enabled}
                                onChange={(e) => updateSetting('slack', 'enabled', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                        </label>
                    </div>

                    {settings.slack.enabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Webhook URL</label>
                            <input
                                type="url"
                                value={settings.slack.webhookUrl}
                                onChange={(e) => updateSetting('slack', 'webhookUrl', e.target.value)}
                                placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            />
                        </div>
                    )}
                </div>

                {/* Dropbox Integration */}
                <div className="border border-gray-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                <Dropbox className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-800">Dropbox</h3>
                                <p className="text-sm text-gray-600">Sync files with Dropbox</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={settings.dropbox.enabled}
                                onChange={(e) => updateSetting('dropbox', 'enabled', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                        </label>
                    </div>

                    {settings.dropbox.enabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Access Token</label>
                            <input
                                type="password"
                                value={settings.dropbox.accessToken}
                                onChange={(e) => updateSetting('dropbox', 'accessToken', e.target.value)}
                                placeholder="Your Dropbox access token"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            />
                        </div>
                    )}
                </div>

                {/* Google Drive Integration */}
                <div className="border border-gray-200 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                <Drive className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-800">Google Drive</h3>
                                <p className="text-sm text-gray-600">Sync files with Google Drive</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={settings.googleDrive.enabled}
                                onChange={(e) => updateSetting('googleDrive', 'enabled', e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                        </label>
                    </div>

                    {settings.googleDrive.enabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Access Token</label>
                            <input
                                type="password"
                                value={settings.googleDrive.accessToken}
                                onChange={(e) => updateSetting('googleDrive', 'accessToken', e.target.value)}
                                placeholder="Your Google Drive access token"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            />
                        </div>
                    )}
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-lg transition-all"
                    >
                        {saved ? <Check className="w-5 h-5" /> : <Save className="w-5 h-5" />}
                        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
}
