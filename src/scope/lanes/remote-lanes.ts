import path from 'path';
import fs from 'fs-extra';
import { REMOTE_REFS_DIR } from '../../constants';
import { Ref } from '../objects';
import LaneId from '../../lane-id/lane-id';
import { Lane } from '../models';
import { BitId } from '../../bit-id';

export type LaneItem = { name: string; head: Ref };
type Lanes = { [laneName: string]: LaneItem[] };

export default class RemoteLanes {
  basePath: string;
  remotes: { [remoteName: string]: Lanes };
  constructor(scopePath: string) {
    this.basePath = path.join(scopePath, REMOTE_REFS_DIR);
    this.remotes = {};
  }
  async addEntry(remoteName: string, laneId: LaneId, componentName: string, head?: Ref) {
    if (!remoteName) throw new TypeError('addEntry expects to get remoteName');
    if (!laneId) throw new TypeError('addEntry expects to get LaneId');
    if (!head) return; // do nothing
    const remoteLane = await this.getRemoteLane(remoteName, laneId);
    const existingComponent = remoteLane.find(n => n.name === componentName);
    if (existingComponent) {
      existingComponent.head = head;
    } else {
      remoteLane.push({ name: componentName, head });
    }
  }

  async getRef(remoteName: string, laneId: LaneId, componentName: string): Promise<Ref | null> {
    if (!remoteName) throw new TypeError('getEntry expects to get remoteName');
    if (!laneId) throw new TypeError('getEntry expects to get laneId');
    if (!this.remotes[remoteName] || !this.remotes[remoteName][laneId.name]) {
      await this.loadRemoteLane(remoteName, laneId);
    }
    const remoteLane = this.remotes[remoteName][laneId.name];
    const existingComponent = remoteLane.find(n => n.name === componentName);
    if (!existingComponent) return null;
    return existingComponent.head;
  }

  async getRemoteLane(remoteName: string, laneId: LaneId): Promise<LaneItem[]> {
    if (!this.remotes[remoteName] || !this.remotes[remoteName][laneId.name]) {
      await this.loadRemoteLane(remoteName, laneId);
    }
    return this.remotes[remoteName][laneId.name];
  }

  async getRemoteBitIds(remoteName: string, laneId: LaneId): Promise<BitId[]> {
    const remoteLane = await this.getRemoteLane(remoteName, laneId);
    return remoteLane.map(item => new BitId({ scope: remoteName, name: item.name, version: item.head.toString() }));
  }

  async loadRemoteLane(remoteName: string, laneId: LaneId) {
    const remoteLanePath = this.composeRemoteLanePath(remoteName, laneId.name);
    try {
      const remoteFile = await fs.readJson(remoteLanePath);
      if (!this.remotes[remoteName]) this.remotes[remoteName] = {};
      this.remotes[remoteName][laneId.name] = remoteFile.map(({ name, head }) => ({ name, head: new Ref(head) }));
    } catch (err) {
      if (err.code === 'ENOENT') {
        if (!this.remotes[remoteName]) this.remotes[remoteName] = {};
        this.remotes[remoteName][laneId.name] = [];
        return;
      }
      throw err;
    }
  }

  async syncWithLaneObject(remoteName: string, lane: Lane) {
    const laneId = lane.toLaneId();
    if (!this.remotes[remoteName] || !this.remotes[remoteName][laneId.name]) {
      await this.loadRemoteLane(remoteName, laneId);
    }
    await Promise.all(
      lane.components.map(component => this.addEntry(remoteName, laneId, component.id.name, component.head))
    );
  }

  composeRemoteLanePath(remoteName: string, laneName: string) {
    return path.join(this.basePath, remoteName, laneName);
  }

  async write() {
    return Promise.all(Object.keys(this.remotes).map(remoteName => this.writeRemoteLanes(remoteName)));
  }

  async writeRemoteLanes(remoteName: string) {
    return Promise.all(
      Object.keys(this.remotes[remoteName]).map(laneName => this.writeRemoteLaneFile(remoteName, laneName))
    );
  }

  async writeRemoteLaneFile(remoteName: string, laneName: string) {
    const obj = this.remotes[remoteName][laneName].map(({ name, head }) => ({ name, head: head.toString() }));
    return fs.outputFile(this.composeRemoteLanePath(remoteName, laneName), JSON.stringify(obj, null, 2));
  }
}
