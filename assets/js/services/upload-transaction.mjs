async function runCleanup(label, operation, cleanupErrors, reportCleanupError) {
  try {
    await operation();
  } catch (error) {
    cleanupErrors.push(`${label}: ${error?.message || error}`);
    reportCleanupError?.(`Upload/rollback/${label}`, error);
  }
}

export async function executeUploadTransaction(
  { file, storageType, items, groupId = null, memorySnapshot },
  operations,
) {
  const kinds = items.map((item) => item.kind);
  const transaction = {
    stage: 'preparação',
    storagePath: null,
    records: [],
    activations: [],
    dashboardSnapshot: null,
    dashboardPersisted: false,
  };

  try {
    transaction.stage = 'leitura do estado anterior';
    transaction.dashboardSnapshot = await operations.captureDashboardRows(kinds);

    transaction.stage = 'armazenamento do arquivo';
    transaction.storagePath = await operations.uploadFile(storageType, file);

    transaction.stage = 'registro do histórico';
    for (const item of items) {
      const record = await operations.createRecord({
        kind: item.kind,
        fileName: file.name,
        fileSize: file.size,
        rows: item.linhas,
        storagePath: transaction.storagePath,
        groupId,
      });
      transaction.records.push(record);
    }

    transaction.stage = 'persistência dos dados';
    await operations.saveAllData(kinds);
    transaction.dashboardPersisted = true;

    transaction.stage = 'ativação do novo dataset';
    for (const record of transaction.records) {
      transaction.activations.push(await operations.activateRecord(record));
    }

    const activeRecords = transaction.activations.map((item) => item.active);
    operations.onActive?.(activeRecords);
    operations.setRuntimeState?.(kinds, 'active');
    return { storagePath: transaction.storagePath, records: activeRecords };
  } catch (error) {
    const cleanupErrors = [];
    const cleanup = (label, operation) =>
      runCleanup(label, operation, cleanupErrors, operations.reportCleanupError);

    for (const activation of [...transaction.activations].reverse()) {
      await cleanup('restaurar arquivo ativo', () => operations.rollbackActivation(activation));
    }
    if (transaction.dashboardPersisted) {
      await cleanup('restaurar dados anteriores', () =>
        operations.restoreDashboardRows(transaction.dashboardSnapshot),
      );
    }
    await cleanup('marcar tentativa como falha', () =>
      operations.markRecordsFailed(transaction.records),
    );
    if (transaction.storagePath) {
      await cleanup('remover arquivo incompleto', () =>
        operations.removeStoredUpload(transaction.storagePath),
      );
    }
    await cleanup('remover metadata incompleta', () =>
      operations.deleteRecords(transaction.records),
    );
    operations.restoreMemoryState?.(memorySnapshot);
    operations.setRuntimeState?.(kinds, 'failed', error?.message || String(error));

    const cleanupMessage = cleanupErrors.length
      ? ` Rollback parcial: ${cleanupErrors.join('; ')}`
      : ' Alterações parciais foram desfeitas.';
    throw new Error(`Falha em ${transaction.stage}: ${error?.message || error}.${cleanupMessage}`, {
      cause: error,
    });
  }
}

export function installLegacyUploadTransaction(target = window) {
  target.executeUploadTransaction = executeUploadTransaction;
}
