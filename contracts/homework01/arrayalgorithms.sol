// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

//- 题目描述：将两个有序数组合并为一个有序数组。

contract ArrayAlgorithm {
    function merge(uint256[] memory a, uint256[] memory b) public pure returns (uint256[] memory) {
        // 实现合并有序数组的逻辑
        uint256[] memory merged = new uint256[](a.length+b.length);
        uint256 i=0;
        uint256 j=0;
        uint256 k=0;
        while(i<a.length&&j<b.length) {
            if(a[i]<b[j]) {
                merged[k]=a[i];
                i+=1;
            } else {
                merged[k]=b[j];
                j+=1;
            }
            k+=1;
        }
        if(i<a.length) {
            for(uint256 l=i;l<a.length;l++) {
                merged[k]=a[l];
                k+=1;
            }
        } else {
            for(uint256 l=j;l<b.length;l++) {
                merged[k]=b[l];
                k+=1;
            }
        }
        return merged;
    }

    function binarySearch(uint256[] memory arr,uint256 target) public pure returns (bool found,uint256 index) {
        // 实现二分查找的逻辑
        uint256 left=0;
        uint256 right=arr.length;
        while(left<right) {
            uint256 mid=(left+right)/2;
            if(arr[mid]==target) {
                return (true,mid);
            } else if(arr[mid]<target) {
                left=mid+1;
            } else {
                right=mid;
            }
        }
        return (false,type(uint256).max);
    }
}
