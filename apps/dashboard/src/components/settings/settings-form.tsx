'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';

import { setArchiveCategory, setLogChannel } from '@/actions/guild-config';
import { CategoryPicker } from '@/components/pickers/category-picker';
import { ChannelPicker } from '@/components/pickers/channel-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

interface Channel {
  readonly id: string;
  readonly name: string;
  readonly type: 'text' | 'announcement';
}
interface Category {
  readonly id: string;
  readonly name: string;
}

interface SettingsFormProps {
  readonly guildId: string;
  readonly channels: readonly Channel[];
  readonly categories: readonly Category[];
  readonly initial: {
    readonly archiveCategoryId: string | null;
    readonly alertChannelId: string | null;
  };
}

export function SettingsForm({
  guildId,
  channels,
  categories,
  initial,
}: SettingsFormProps): React.JSX.Element {
  const router = useRouter();
  const [archiveCategoryId, setArchiveCategoryIdState] = React.useState(
    initial.archiveCategoryId ?? '',
  );
  const [alertChannelId, setAlertChannelIdState] = React.useState(initial.alertChannelId ?? '');
  const [savingArchive, setSavingArchive] = React.useState(false);
  const [savingLog, setSavingLog] = React.useState(false);

  async function saveArchive(): Promise<void> {
    if (savingArchive) return;
    setSavingArchive(true);
    const result = await setArchiveCategory({
      guildId,
      categoryId: archiveCategoryId === '' ? null : archiveCategoryId,
    });
    setSavingArchive(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Archive category saved');
    router.refresh();
  }

  async function saveLog(): Promise<void> {
    if (savingLog) return;
    setSavingLog(true);
    const result = await setLogChannel({
      guildId,
      channelId: alertChannelId === '' ? null : alertChannelId,
    });
    setSavingLog(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Log channel saved');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Archive category</CardTitle>
          <CardDescription>
            Closed tickets are moved into this category — keeps the active categories tidy. Leave
            blank to skip the move on close.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="archive-category">Category</Label>
            <CategoryPicker
              id="archive-category"
              categories={categories}
              value={archiveCategoryId}
              onChange={setArchiveCategoryIdState}
              placeholder="No archive category"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void saveArchive();
              }}
              disabled={savingArchive}
              size="sm"
            >
              {savingArchive ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log channel</CardTitle>
          <CardDescription>
            Receives audit-log embeds when tickets are deleted. Optional — leave blank to skip
            modlog posts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="log-channel">Channel</Label>
            <ChannelPicker
              id="log-channel"
              channels={channels}
              value={alertChannelId}
              onChange={setAlertChannelIdState}
              placeholder="No log channel"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void saveLog();
              }}
              disabled={savingLog}
              size="sm"
            >
              {savingLog ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
