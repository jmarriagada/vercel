import type { Service } from '@vercel/fs-detectors';
import { isExperimentalService } from '@vercel/fs-detectors';
import {
  getServiceQueueTopicConfigs,
  isQueueBackedService,
} from '@vercel/build-utils';
import type { DevQueueConsumer } from './queue-broker';

export function getExperimentalServiceQueueConsumers({
  services,
  getServiceOrigin,
}: {
  services: Service[];
  getServiceOrigin: (name: string) => string | null;
}): DevQueueConsumer[] {
  return services
    .filter(isExperimentalService)
    .filter(isQueueBackedService)
    .map(service => ({
      name: service.name,
      topics: getServiceQueueTopicConfigs(service),
      getOrigin: () => getServiceOrigin(service.name),
    }));
}
