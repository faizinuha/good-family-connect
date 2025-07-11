
import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Device = Tables<'devices'> & {
  profiles?: {
    full_name: string;
  };
};

type ActivityLog = Tables<'activity_logs'> & {
  profiles?: {
    full_name: string;
  };
};

export function useDeviceMonitoring() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setDevices([]);
      setActivities([]);
      setLoading(false);
      return;
    }

    fetchDevices();
    fetchActivities();

    // Real-time subscription for device updates
    const deviceChannel = supabase
      .channel('device-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'devices'
        },
        () => {
          fetchDevices();
        }
      )
      .subscribe();

    // Real-time subscription for activity updates
    const activityChannel = supabase
      .channel('activity-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_logs'
        },
        () => {
          fetchActivities();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(deviceChannel);
      supabase.removeChannel(activityChannel);
    };
  }, [user]);

  const fetchDevices = async () => {
    try {
      const { data, error } = await supabase
        .from('devices')
        .select(`
          *,
          profiles(full_name)
        `)
        .order('last_seen', { ascending: false });

      if (error) throw error;
      
      const mappedDevices = (data || []).map(device => ({
        ...device,
        profile: device.profiles ? { full_name: device.profiles.full_name } : undefined
      })) as Device[];
      
      setDevices(mappedDevices);
    } catch (error) {
      console.error('Error fetching devices:', error);
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchActivities = async () => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select(`
          *,
          profiles(full_name)
        `)
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) throw error;
      
      const mappedActivities = (data || []).map(activity => ({
        ...activity,
        profile: activity.profiles ? { full_name: activity.profiles.full_name } : undefined
      })) as ActivityLog[];
      
      setActivities(mappedActivities);
    } catch (error) {
      console.error('Error fetching activities:', error);
      setActivities([]);
    }
  };

  const updateDeviceStatus = async (deviceId: string, status: 'online' | 'offline', currentApp?: string) => {
    try {
      const { error } = await supabase
        .from('devices')
        .update({
          status,
          current_app: currentApp,
          last_seen: new Date().toISOString()
        })
        .eq('id', deviceId);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating device status:', error);
      throw error;
    }
  };

  const logActivity = async (appName: string, activityType: string, durationMinutes?: number) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('activity_logs')
        .insert({
          user_id: user.id,
          app_name: appName,
          activity_type: activityType,
          duration_minutes: durationMinutes
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error logging activity:', error);
      throw error;
    }
  };

  return {
    devices,
    activities,
    loading,
    updateDeviceStatus,
    logActivity,
    refreshDevices: fetchDevices,
    refreshActivities: fetchActivities
  };
}
